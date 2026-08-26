"use client";

import {
  ArrowRight,
  Bot,
  Check,
  CircleAlert,
  CircleCheck,
  Clipboard,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  HeartHandshake,
  History,
  Info,
  LayoutTemplate,
  Lock,
  LockOpen,
  MapPin,
  Move,
  PencilRuler,
  Plus,
  RefreshCcw,
  RotateCcw,
  Route,
  Ruler,
  ShieldCheck,
  Sparkles,
  Trash2,
  Undo2,
  UserRound,
  Waypoints,
  X,
} from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  applyProposalMoves,
  clampFurniture,
  findCriticalBarriers,
  getApproachZone,
  getFurnitureDimensions,
  measureLayout,
  objectsOverlap,
} from "@/lib/geometry";
import { initialState } from "@/lib/initial-state";
import {
  buildWorkspace,
  furniturePresets,
  scenarioTemplates,
} from "@/lib/scenarios";
import { evidenceGroundedStories } from "@/lib/user-stories";
import type {
  ActivityItem,
  ApproachSide,
  FurnitureItem,
  LayoutProposal,
  MobilityProfile,
  MovementPriority,
  ProposalMove,
  RoutePurpose,
  RouteTarget,
  WebMcpStatus,
  WorkspaceSnapshot,
  WorkspaceState,
} from "@/lib/types";

const STORAGE_KEY = "homewheel-workspace-v2";
const TOOL_NAMES = [
  "get_workspace_state",
  "set_mobility_profile",
  "simulate_routes",
  "find_barriers",
  "create_layout_proposal",
  "set_object_constraint",
  "compare_layouts",
  "restore_layout",
] as const;

const FEEDBACK_SUGGESTIONS = [
  "Keep the dresser close to the entrance",
  "The drawers must keep facing the bed",
  "Move fewer objects",
];

const PRIORITY_OPTIONS: Array<{
  id: MovementPriority;
  label: string;
}> = [
  { id: "transfer-safety", label: "Transfer safety" },
  { id: "fewest-moves", label: "Fewer changes" },
  { id: "daily-reach", label: "Daily reach" },
  { id: "daylight", label: "Daylight" },
];

const PURPOSE_LABELS: Record<RoutePurpose, string> = {
  transfer: "Transfer",
  work: "Work",
  reach: "Reach",
};

type SetupDraft = {
  room: WorkspaceState["room"];
  furniture: FurnitureItem[];
  targets: RouteTarget[];
  selectedId: string | null;
};

const createId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const cloneFurniture = (items: FurnitureItem[]) =>
  items.map((item) => ({ ...item }));

const cloneTargets = (targets: RouteTarget[]) =>
  targets.map((target) => ({ ...target }));

function createSnapshot(
  state: WorkspaceState,
  label: string,
): WorkspaceSnapshot {
  return {
    id: createId("layout"),
    label,
    createdAt: new Date().toISOString(),
    scenarioId: state.scenarioId,
    scenarioName: state.scenarioName,
    question: state.question,
    room: { ...state.room, door: { ...state.room.door } },
    furniture: cloneFurniture(state.furniture),
    mobility: {
      ...state.mobility,
      priorities: [...state.mobility.priorities],
    },
    targets: cloneTargets(state.targets),
    activeTargetId: state.activeTargetId,
  };
}

function createActivity(
  actor: ActivityItem["actor"],
  title: string,
  detail: string,
  reversible = true,
): ActivityItem {
  return {
    id: createId("activity"),
    actor,
    title,
    detail,
    at: new Date().toISOString(),
    reversible,
  };
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatMeters(centimeters: number) {
  return `${Math.round(centimeters / 10) / 10} m`;
}

function changedObjects(
  baseline: FurnitureItem[],
  current: FurnitureItem[],
) {
  return current.filter((item) => {
    const original = baseline.find((candidate) => candidate.id === item.id);
    return (
      !original ||
      original.x !== item.x ||
      original.y !== item.y ||
      original.rotation !== item.rotation ||
      original.locked !== item.locked ||
      original.stabilityCritical !== item.stabilityCritical
    );
  });
}

function proposalPrompt(state: WorkspaceState) {
  const feedback = state.feedback.at(-1);
  const priorityLine =
    state.mobility.priorities.length > 0
      ? ` Prioritize: ${state.mobility.priorities
          .map(
            (priority) =>
              PRIORITY_OPTIONS.find((option) => option.id === priority)
                ?.label ?? priority,
          )
          .join(", ")}.`
      : "";
  const feedbackLine = feedback
    ? ` The person rejected the last option because: "${feedback.reason}". Honor that feedback in the revision.`
    : "";
  return `Review every required destination in this ${state.scenarioName.toLowerCase()}. Preserve all locked or stability-critical objects and personal constraints.${priorityLine} Validate the clear approach zone at each destination. Identify the smallest useful set of furniture changes, then create a layout proposal for review—do not directly alter the room.${feedbackLine}`;
}

export default function Home() {
  const [state, setState] = useState<WorkspaceState>(initialState);
  const [webMcpStatus, setWebMcpStatus] =
    useState<WebMcpStatus>("checking");
  const [copied, setCopied] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [showUserStories, setShowUserStories] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackDraft, setFeedbackDraft] = useState("");
  const [setupDraft, setSetupDraft] = useState<SetupDraft | null>(null);
  const stateRef = useRef(state);
  const toolsRegisteredRef = useRef(false);
  const dragRef = useRef<{
    id: string;
    offsetX: number;
    offsetY: number;
    startX: number;
    startY: number;
    snapshot: WorkspaceSnapshot;
  } | null>(null);

  const commit = useCallback((next: WorkspaceState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    stateRef.current = state;
    if (isHydrated) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
  }, [isHydrated, state]);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as WorkspaceState;
        if (parsed.version === 2) {
          const defaults = buildWorkspace(parsed.scenarioId);
          const normalized: WorkspaceState = {
            ...parsed,
            mobility: {
              ...parsed.mobility,
              priorities:
                parsed.mobility.priorities ?? defaults.mobility.priorities,
            },
            furniture: parsed.furniture.map((item) => ({
              ...item,
              stabilityCritical: item.stabilityCritical ?? false,
            })),
            targets: parsed.targets.map((target) => ({
              ...target,
              purpose: target.purpose ?? "reach",
              clearanceDepth: target.clearanceDepth ?? 80,
            })),
            baseline: {
              ...parsed.baseline,
              mobility: {
                ...parsed.baseline.mobility,
                priorities:
                  parsed.baseline.mobility.priorities ??
                  defaults.mobility.priorities,
              },
              furniture: parsed.baseline.furniture.map((item) => ({
                ...item,
                stabilityCritical: item.stabilityCritical ?? false,
              })),
              targets: parsed.baseline.targets.map((target) => ({
                ...target,
                purpose: target.purpose ?? "reach",
                clearanceDepth: target.clearanceDepth ?? 80,
              })),
            },
          };
          stateRef.current = normalized;
          setState(normalized);
        }
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }
    setIsHydrated(true);
  }, []);

  const metrics = useMemo(
    () =>
      measureLayout(
        state.room,
        state.furniture,
        state.mobility,
        state.targets,
      ),
    [state.furniture, state.mobility, state.room, state.targets],
  );
  const activeRoute =
    metrics.routes.find((route) => route.targetId === state.activeTargetId) ??
    metrics.routes[0];
  const previewMetrics = state.proposal?.afterMetrics ?? null;
  const activePreviewRoute =
    previewMetrics?.routes.find(
      (route) => route.targetId === state.activeTargetId,
    ) ?? previewMetrics?.routes[0];
  const visibleMetrics = previewMetrics ?? metrics;
  const visibleActiveRoute = activePreviewRoute ?? activeRoute;
  const activeTarget =
    state.targets.find((target) => target.id === state.activeTargetId) ??
    state.targets[0];
  const visibleFurniture =
    state.proposal?.previewFurniture ?? state.furniture;
  const activeApproachZone = activeTarget
    ? getApproachZone(visibleFurniture, state.mobility, activeTarget)
    : null;
  const barriers = useMemo(
    () =>
      findCriticalBarriers(
        state.room,
        state.furniture,
        state.mobility,
        state.targets,
      ),
    [state.furniture, state.mobility, state.room, state.targets],
  );
  const selected = useMemo(
    () =>
      state.furniture.find((item) => item.id === state.selectedId) ?? null,
    [state.furniture, state.selectedId],
  );

  const mutate = useCallback(
    (
      actor: ActivityItem["actor"],
      label: string,
      detail: string,
      update: (current: WorkspaceState) => WorkspaceState,
    ) => {
      const current = stateRef.current;
      const snapshot = createSnapshot(current, `Before: ${label}`);
      const updated = update(current);
      const next: WorkspaceState = {
        ...updated,
        history: [...current.history, snapshot].slice(-30),
        activity: [
          createActivity(actor, label, detail),
          ...current.activity,
        ].slice(0, 40),
      };
      commit(next);
      return next;
    },
    [commit],
  );

  const restoreSnapshot = useCallback(
    (
      snapshot: WorkspaceSnapshot,
      actor: ActivityItem["actor"] = "You",
    ) => {
      const current = stateRef.current;
      const before = createSnapshot(current, "Before restore");
      const next: WorkspaceState = {
        ...current,
        scenarioId: snapshot.scenarioId,
        scenarioName: snapshot.scenarioName,
        question: snapshot.question,
        room: { ...snapshot.room, door: { ...snapshot.room.door } },
        furniture: cloneFurniture(snapshot.furniture),
        mobility: {
          ...snapshot.mobility,
          priorities: [...snapshot.mobility.priorities],
        },
        targets: cloneTargets(snapshot.targets),
        activeTargetId: snapshot.activeTargetId,
        proposal: null,
        history: [...current.history, before].slice(-30),
        activity: [
          createActivity(
            actor,
            "Layout restored",
            `Returned to “${snapshot.label}”.`,
          ),
          ...current.activity,
        ].slice(0, 40),
      };
      commit(next);
      return next;
    },
    [commit],
  );

  const createProposal = useCallback(
    (
      title: string,
      rationale: string,
      moves: ProposalMove[],
      tradeoffs: string[],
      respondsToFeedbackId?: string,
    ) => {
      const current = stateRef.current;
      const prepared = applyProposalMoves(
        current.room,
        current.furniture,
        moves,
      );
      if (prepared.errors.length > 0) {
        throw new Error(prepared.errors.join(" "));
      }

      const beforeMetrics = measureLayout(
        current.room,
        current.furniture,
        current.mobility,
        current.targets,
      );
      const afterMetrics = measureLayout(
        current.room,
        prepared.furniture,
        current.mobility,
        current.targets,
      );
      if (
        afterMetrics.requiredReachable < beforeMetrics.requiredReachable
      ) {
        throw new Error(
          "The proposal reduces access to required destinations.",
        );
      }

      const proposal: LayoutProposal = {
        id: createId("proposal"),
        title,
        rationale,
        moves,
        tradeoffs,
        createdAt: new Date().toISOString(),
        previewFurniture: prepared.furniture,
        beforeMetrics,
        afterMetrics,
        respondsToFeedbackId,
      };
      const next: WorkspaceState = {
        ...current,
        proposal,
        showBaseline: false,
        activity: [
          createActivity(
            "Agent",
            "Proposal ready for review",
            `${title}. Nothing has moved yet.`,
            false,
          ),
          ...current.activity,
        ].slice(0, 40),
      };
      commit(next);
      return proposal;
    },
    [commit],
  );

  const executeTool = useCallback(
    (name: (typeof TOOL_NAMES)[number], input: Record<string, unknown>) => {
      const current = stateRef.current;
      const currentMetrics = measureLayout(
        current.room,
        current.furniture,
        current.mobility,
        current.targets,
      );

      if (name === "get_workspace_state") {
        return {
          scenario: {
            id: current.scenarioId,
            name: current.scenarioName,
            question: current.question,
          },
          room_dimensions_cm: current.room,
          mobility_profile: current.mobility,
          personal_priorities: current.mobility.priorities.map(
            (priority) =>
              PRIORITY_OPTIONS.find((option) => option.id === priority)
                ?.label ?? priority,
          ),
          furniture: current.furniture,
          destinations: current.targets,
          route_metrics: currentMetrics,
          user_constraints: current.furniture
            .filter((item) => item.locked || item.stabilityCritical)
            .map((item) => ({
              object_id: item.id,
              object_name: item.name,
              reason: item.lockReason,
              stability_critical: Boolean(item.stabilityCritical),
            })),
          latest_feedback: current.feedback.at(-1) ?? null,
          pending_proposal: current.proposal
            ? {
                id: current.proposal.id,
                title: current.proposal.title,
                moves: current.proposal.moves,
                requires_human_approval: true,
              }
            : null,
          history: current.history.map((snapshot) => ({
            snapshot_id: snapshot.id,
            label: snapshot.label,
            created_at: snapshot.createdAt,
          })),
          instruction:
            "Use create_layout_proposal for layout changes. It previews changes and requires the person to accept them in the page.",
        };
      }

      if (name === "simulate_routes") {
        return currentMetrics;
      }

      if (name === "find_barriers") {
        return {
          route_metrics: currentMetrics,
          critical_barriers: findCriticalBarriers(
            current.room,
            current.furniture,
            current.mobility,
            current.targets,
          ),
          locked_objects: current.furniture
            .filter((item) => item.locked || item.stabilityCritical)
            .map((item) => ({
              id: item.id,
              name: item.name,
              reason: item.lockReason,
              stability_critical: Boolean(item.stabilityCritical),
            })),
          latest_feedback: current.feedback.at(-1) ?? null,
        };
      }

      if (name === "set_mobility_profile") {
        const patch = input as Partial<MobilityProfile>;
        const nextProfile: MobilityProfile = {
          deviceLabel:
            typeof patch.deviceLabel === "string" &&
            patch.deviceLabel.trim().length > 0
              ? patch.deviceLabel.trim().slice(0, 40)
              : current.mobility.deviceLabel,
          chairWidth: Math.max(
            45,
            Math.min(
              110,
              Number(patch.chairWidth ?? current.mobility.chairWidth),
            ),
          ),
          minimumPassage: Math.max(
            65,
            Math.min(
              150,
              Number(
                patch.minimumPassage ?? current.mobility.minimumPassage,
              ),
            ),
          ),
          turningDiameter: Math.max(
            90,
            Math.min(
              220,
              Number(
                patch.turningDiameter ?? current.mobility.turningDiameter,
              ),
            ),
          ),
          priorities: Array.isArray(patch.priorities)
            ? patch.priorities.filter((priority) =>
                PRIORITY_OPTIONS.some((option) => option.id === priority),
              )
            : current.mobility.priorities,
        };
        const next = mutate(
          "Agent",
          "Mobility profile updated",
          "The person’s movement envelope now drives every route check.",
          (workspace) => ({
            ...workspace,
            mobility: nextProfile,
            proposal: null,
          }),
        );
        return {
          mobility_profile: next.mobility,
          route_metrics: measureLayout(
            next.room,
            next.furniture,
            next.mobility,
            next.targets,
          ),
        };
      }

      if (name === "set_object_constraint") {
        const objectId = String(input.object_id ?? "");
        const item = current.furniture.find(
          (candidate) => candidate.id === objectId,
        );
        if (!item) throw new Error(`Unknown object_id: ${objectId}`);
        const locked =
          typeof input.locked === "boolean" ? input.locked : true;
        const stabilityCritical =
          typeof input.stability_critical === "boolean"
            ? input.stability_critical
            : item.stabilityCritical ?? false;
        const reason = String(
          input.reason ?? (locked ? "User preference" : "Constraint removed"),
        ).slice(0, 160);
        const next = mutate(
          "Agent",
          locked ? `${item.name} protected` : `${item.name} released`,
          reason,
          (workspace) => ({
            ...workspace,
            proposal: null,
            furniture: workspace.furniture.map((candidate) =>
              candidate.id === objectId
                ? {
                    ...candidate,
                    locked: locked || stabilityCritical,
                    stabilityCritical,
                    lockReason:
                      locked || stabilityCritical ? reason : undefined,
                  }
                : candidate,
            ),
          }),
        );
        return {
          object: next.furniture.find(
            (candidate) => candidate.id === objectId,
          ),
        };
      }

      if (name === "create_layout_proposal") {
        const rawMoves = Array.isArray(input.moves) ? input.moves : [];
        if (rawMoves.length === 0 || rawMoves.length > 5) {
          throw new Error("Provide between one and five furniture moves.");
        }
        const moves: ProposalMove[] = rawMoves.map((raw) => {
          const move = raw as Record<string, unknown>;
          return {
            objectId: String(move.object_id ?? ""),
            x: Number(move.x_cm),
            y: Number(move.y_cm),
            rotation:
              Number(move.rotation_degrees ?? 0) === 90 ? 90 : 0,
            reason: String(move.reason ?? "Improve access").slice(0, 180),
          };
        });
        const proposal = createProposal(
          String(input.title ?? "Layout proposal").slice(0, 80),
          String(input.rationale ?? "Improve required routes.").slice(0, 600),
          moves,
          Array.isArray(input.tradeoffs)
            ? input.tradeoffs
                .map((value) => String(value).slice(0, 160))
                .slice(0, 4)
            : [],
          typeof input.responds_to_feedback_id === "string"
            ? input.responds_to_feedback_id
            : undefined,
        );
        return {
          proposal_id: proposal.id,
          title: proposal.title,
          moves: proposal.moves,
          before_metrics: proposal.beforeMetrics,
          preview_metrics: proposal.afterMetrics,
          requires_human_approval: true,
          live_layout_changed: false,
        };
      }

      if (name === "compare_layouts") {
        const next = {
          ...current,
          showBaseline: true,
          activity: [
            createActivity(
              "Agent",
              "Baseline comparison shown",
              "Original object positions are outlined on the room.",
              false,
            ),
            ...current.activity,
          ].slice(0, 40),
        };
        commit(next);
        return {
          changed_objects: changedObjects(
            current.baseline.furniture,
            current.furniture,
          ),
          baseline_label: current.baseline.label,
        };
      }

      if (name === "restore_layout") {
        const snapshotId = String(input.snapshot_id ?? "baseline");
        const snapshot =
          snapshotId === "baseline"
            ? current.baseline
            : current.history.find((item) => item.id === snapshotId);
        if (!snapshot) throw new Error(`Unknown snapshot_id: ${snapshotId}`);
        const next = restoreSnapshot(snapshot, "Agent");
        return {
          restored_snapshot: snapshot.label,
          route_metrics: measureLayout(
            next.room,
            next.furniture,
            next.mobility,
            next.targets,
          ),
        };
      }

      throw new Error(`Unsupported tool: ${name}`);
    },
    [commit, createProposal, mutate, restoreSnapshot],
  );

  useEffect(() => {
    if (!document.modelContext) {
      setWebMcpStatus("unavailable");
      return;
    }
    if (toolsRegisteredRef.current) {
      setWebMcpStatus("available");
      return;
    }

    const toolDefinitions: WebMcpTool[] = [
      {
        name: "get_workspace_state",
        description:
          "Read the complete HomeWheel workspace: room and furniture geometry, every destination route and approach zone, personal mobility profile and priorities, protected or stability-critical constraints, prior rejection feedback, and pending proposal. Use this first.",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true },
        execute: (input) => executeTool("get_workspace_state", input),
      },
      {
        name: "set_mobility_profile",
        description:
          "Update the personal movement envelope used by all route simulations. Only set values the person explicitly provides. This is personal planning, not medical or building-code certification.",
        inputSchema: {
          type: "object",
          properties: {
            deviceLabel: {
              type: "string",
              description: "The person's preferred name for their mobility device.",
            },
            chairWidth: {
              type: "number",
              minimum: 45,
              maximum: 110,
              description: "Mobility device width in centimeters.",
            },
            minimumPassage: {
              type: "number",
              minimum: 65,
              maximum: 150,
              description:
                "Person-preferred minimum clear passage in centimeters.",
            },
            turningDiameter: {
              type: "number",
              minimum: 90,
              maximum: 220,
              description: "Preferred turning diameter in centimeters.",
            },
            priorities: {
              type: "array",
              description:
                "The person's explicit decision priorities for proposals.",
              items: {
                type: "string",
                enum: PRIORITY_OPTIONS.map((option) => option.id),
              },
            },
          },
        },
        execute: (input) => executeTool("set_mobility_profile", input),
      },
      {
        name: "simulate_routes",
        description:
          "Measure every required and optional route in the current live layout, including reachability, path length, estimated minimum clearance, clear transfer/work/reach zones, and whether a turning spot exists.",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true },
        execute: (input) => executeTool("simulate_routes", input),
      },
      {
        name: "find_barriers",
        description:
          "Identify movable furniture that causes required route failures while preserving locked objects and reporting the person's latest rejected-plan feedback.",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true },
        execute: (input) => executeTool("find_barriers", input),
      },
      {
        name: "create_layout_proposal",
        description:
          "Create a visible, collision-checked preview of one to five exact furniture moves. This never changes the live room: the person must accept it in the page. Honor protected positions, stability-critical furniture, approach zones, personal priorities, and latest feedback.",
        inputSchema: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Concise proposal name.",
            },
            rationale: {
              type: "string",
              description:
                "Explain why these moves improve the person's required routes.",
            },
            moves: {
              type: "array",
              minItems: 1,
              maxItems: 5,
              items: {
                type: "object",
                properties: {
                  object_id: { type: "string" },
                  x_cm: { type: "number" },
                  y_cm: { type: "number" },
                  rotation_degrees: {
                    type: "number",
                    enum: [0, 90],
                  },
                  reason: {
                    type: "string",
                    description: "User-visible reason for this exact move.",
                  },
                },
                required: [
                  "object_id",
                  "x_cm",
                  "y_cm",
                  "reason",
                ],
              },
            },
            tradeoffs: {
              type: "array",
              maxItems: 4,
              items: { type: "string" },
            },
            responds_to_feedback_id: {
              type: "string",
              description:
                "Latest feedback id when this proposal revises a rejected option.",
            },
          },
          required: ["title", "rationale", "moves"],
        },
        execute: (input) => executeTool("create_layout_proposal", input),
      },
      {
        name: "set_object_constraint",
        description:
          "Protect or release a furniture position and optionally mark it stability-critical after the person states a lived preference such as an outlet, transfer side, transfer stability, drawer access, light, or sentimental placement.",
        inputSchema: {
          type: "object",
          properties: {
            object_id: { type: "string" },
            locked: { type: "boolean" },
            stability_critical: {
              type: "boolean",
              description:
                "Whether movement could compromise stability during transfers or daily use.",
            },
            reason: {
              type: "string",
              description: "Why this position matters to the person.",
            },
          },
          required: ["object_id", "locked", "reason"],
        },
        execute: (input) => executeTool("set_object_constraint", input),
      },
      {
        name: "compare_layouts",
        description:
          "Show the room's baseline positions and return everything that changed.",
        inputSchema: { type: "object", properties: {} },
        execute: (input) => executeTool("compare_layouts", input),
      },
      {
        name: "restore_layout",
        description:
          "Restore the scenario baseline or a history snapshot. Restoration is visible and logged.",
        inputSchema: {
          type: "object",
          properties: {
            snapshot_id: {
              type: "string",
              description:
                "Use 'baseline' or a snapshot id from get_workspace_state.",
            },
          },
          required: ["snapshot_id"],
        },
        execute: (input) => executeTool("restore_layout", input),
      },
    ];

    toolDefinitions.forEach((tool) => document.modelContext?.registerTool(tool));
    toolsRegisteredRef.current = true;
    setWebMcpStatus("available");

    return () => {
      if (typeof document.modelContext?.unregisterTool === "function") {
        TOOL_NAMES.forEach((name) =>
          document.modelContext?.unregisterTool?.(name),
        );
        toolsRegisteredRef.current = false;
      }
    };
  }, [executeTool]);

  const handlePointerDown = (
    event: ReactPointerEvent<SVGGElement>,
    item: FurnitureItem,
  ) => {
    if (state.proposal) return;
    if (item.locked || item.stabilityCritical) {
      commit({ ...stateRef.current, selectedId: item.id });
      return;
    }
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(svg.getScreenCTM()?.inverse());
    dragRef.current = {
      id: item.id,
      offsetX: local.x - item.x,
      offsetY: local.y - item.y,
      startX: item.x,
      startY: item.y,
      snapshot: createSnapshot(stateRef.current, `Before moving ${item.name}`),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    commit({ ...stateRef.current, selectedId: item.id });
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(svg.getScreenCTM()?.inverse());
    const current = stateRef.current;
    const item = current.furniture.find(
      (candidate) => candidate.id === drag.id,
    );
    if (!item) return;
    const nextItem = clampFurniture(
      {
        ...item,
        x: Math.round((local.x - drag.offsetX) / 5) * 5,
        y: Math.round((local.y - drag.offsetY) / 5) * 5,
      },
      current.room,
    );
    const collision = current.furniture.some(
      (candidate) =>
        candidate.id !== nextItem.id && objectsOverlap(nextItem, candidate),
    );
    if (collision) return;
    commit({
      ...current,
      furniture: current.furniture.map((candidate) =>
        candidate.id === nextItem.id ? nextItem : candidate,
      ),
    });
  };

  const handlePointerUp = (event: ReactPointerEvent<SVGGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    const current = stateRef.current;
    const item = current.furniture.find(
      (candidate) => candidate.id === drag.id,
    );
    if (!item || (item.x === drag.startX && item.y === drag.startY)) return;
    commit({
      ...current,
      history: [...current.history, drag.snapshot].slice(-30),
      activity: [
        createActivity(
          "You",
          `${item.name} moved`,
          `Placed at ${Math.round(item.x)} × ${Math.round(item.y)} cm.`,
        ),
        ...current.activity,
      ].slice(0, 40),
    });
  };

  const nudgeFurniture = (
    item: FurnitureItem,
    direction: "left" | "right" | "up" | "down",
  ) => {
    if (
      item.locked ||
      item.stabilityCritical ||
      stateRef.current.proposal
    ) {
      return;
    }
    const delta = {
      left: { x: -5, y: 0 },
      right: { x: 5, y: 0 },
      up: { x: 0, y: -5 },
      down: { x: 0, y: 5 },
    }[direction];
    const current = stateRef.current;
    const proposed = clampFurniture(
      { ...item, x: item.x + delta.x, y: item.y + delta.y },
      current.room,
    );
    const collision = current.furniture.some(
      (candidate) =>
        candidate.id !== proposed.id && objectsOverlap(proposed, candidate),
    );
    if (collision) return;
    mutate(
      "You",
      `${item.name} nudged`,
      `Moved ${direction} by 5 cm with the keyboard.`,
      (workspace) => ({
        ...workspace,
        selectedId: item.id,
        proposal: null,
        furniture: workspace.furniture.map((candidate) =>
          candidate.id === item.id ? proposed : candidate,
        ),
      }),
    );
  };

  const updateMobility = (patch: Partial<MobilityProfile>) => {
    mutate(
      "You",
      "Movement profile updated",
      "Every destination route was recalculated around the new preference.",
      (current) => ({
        ...current,
        proposal: null,
        mobility: { ...current.mobility, ...patch },
      }),
    );
  };

  const toggleSelectedLock = () => {
    if (!selected) return;
    const isProtected = selected.locked || selected.stabilityCritical;
    mutate(
      "You",
      isProtected
        ? `${selected.name} released`
        : `${selected.name} protected`,
      isProtected
        ? "The agent may now include this object in proposals."
        : "Future proposals must preserve this position.",
      (current) => ({
        ...current,
        proposal: null,
        furniture: current.furniture.map((item) =>
          item.id === selected.id
            ? {
                ...item,
                locked: !isProtected,
                stabilityCritical: isProtected
                  ? false
                  : item.stabilityCritical,
                lockReason: !isProtected
                  ? item.lockReason ?? "Keep this position"
                  : undefined,
              }
            : item,
        ),
      }),
    );
  };

  const rotateSelected = () => {
    if (
      !selected ||
      selected.locked ||
      selected.stabilityCritical ||
      state.proposal
    ) {
      return;
    }
    const rotated = clampFurniture(
      { ...selected, rotation: selected.rotation === 0 ? 90 : 0 },
      state.room,
    );
    const collision = state.furniture.some(
      (candidate) =>
        candidate.id !== rotated.id && objectsOverlap(rotated, candidate),
    );
    if (collision) return;
    mutate(
      "You",
      `${selected.name} rotated`,
      "Rotated 90 degrees.",
      (current) => ({
        ...current,
        furniture: current.furniture.map((item) =>
          item.id === selected.id ? rotated : item,
        ),
      }),
    );
  };

  const undo = () => {
    const current = stateRef.current;
    const snapshot = current.history.at(-1);
    if (!snapshot) return;
    commit({
      ...current,
      scenarioId: snapshot.scenarioId,
      scenarioName: snapshot.scenarioName,
      question: snapshot.question,
      room: { ...snapshot.room, door: { ...snapshot.room.door } },
      furniture: cloneFurniture(snapshot.furniture),
      mobility: {
        ...snapshot.mobility,
        priorities: [...snapshot.mobility.priorities],
      },
      targets: cloneTargets(snapshot.targets),
      activeTargetId: snapshot.activeTargetId,
      proposal: null,
      history: current.history.slice(0, -1),
      activity: [
        createActivity("You", "Last change undone", snapshot.label, false),
        ...current.activity,
      ].slice(0, 40),
    });
  };

  const loadScenario = (scenarioId: string) => {
    const next = buildWorkspace(scenarioId);
    commit(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const resetScenario = () => loadScenario(state.scenarioId);

  const acceptProposal = () => {
    const proposal = stateRef.current.proposal;
    if (!proposal) return;
    mutate(
      "You",
      "Proposal accepted",
      `${proposal.title}: ${proposal.moves.length} ${
        proposal.moves.length === 1 ? "move" : "moves"
      } applied.`,
      (current) => ({
        ...current,
        furniture: cloneFurniture(proposal.previewFurniture),
        proposal: null,
        showBaseline: true,
      }),
    );
  };

  const rejectProposal = () => {
    const current = stateRef.current;
    const proposal = current.proposal;
    const reason = feedbackDraft.trim();
    if (!proposal || !reason) return;
    const feedback = {
      id: createId("feedback"),
      proposalId: proposal.id,
      proposalTitle: proposal.title,
      reason: reason.slice(0, 240),
      createdAt: new Date().toISOString(),
    };
    commit({
      ...current,
      proposal: null,
      feedback: [...current.feedback, feedback].slice(-10),
      activity: [
        createActivity(
          "You",
          "Revision requested",
          feedback.reason,
          false,
        ),
        ...current.activity,
      ].slice(0, 40),
    });
    setFeedbackDraft("");
    setShowFeedback(false);
  };

  const guidedProposal = () => {
    const current = stateRef.current;
    const latestFeedback = current.feedback.at(-1);
    if (current.scenarioId === "bedroom") {
      if (latestFeedback) {
        createProposal(
          "Keep the dresser orientation",
          "Move the dresser below the bed so its drawers continue facing the bed while opening the left-side route.",
          [
            {
              objectId: "dresser",
              x: 180,
              y: 180,
              rotation: 0,
              reason:
                "Keep the drawers facing the bed while moving the barrier out of the route.",
            },
          ],
          [
            "The dresser moves closer to the foot of the bed.",
            "The door swing and locked desk remain unchanged.",
          ],
          latestFeedback.id,
        );
      } else {
        createProposal(
          "Open the left-side route",
          "Rotate the dresser against the right wall. This preserves the locked bed and desk and improves required destination access with one move.",
          [
            {
              objectId: "dresser",
              x: 418,
              y: 124,
              rotation: 90,
              reason:
                "Move the critical barrier out of the doorway-to-bed corridor.",
            },
          ],
          [
            "The dresser changes orientation.",
            "No locked furniture moves.",
          ],
        );
      }
      return;
    }

    if (current.scenarioId === "studio") {
      createProposal(
        "Restore the studio loop",
        "Move the wardrobe to the lower-right wall to reconnect the required sofa and work-table routes.",
        [
          {
            objectId: "wardrobe",
            x: 340,
            y: 292,
            rotation: 0,
            reason: "Remove the central pinch point.",
          },
        ],
        ["Storage moves farther from the sofa."],
        latestFeedback?.id,
      );
      return;
    }

    const barrier = findCriticalBarriers(
      current.room,
      current.furniture,
      current.mobility,
      current.targets,
    )[0];
    if (!barrier) return;
    const item = current.furniture.find(
      (candidate) => candidate.id === barrier.id,
    );
    if (!item) return;
    createProposal(
      "Clear the custom route",
      `Move ${item.name} to the upper-left corner as a reversible starting option.`,
      [
        {
          objectId: item.id,
          x: 10,
          y: 10,
          rotation: item.rotation,
          reason: "Remove the identified route barrier.",
        },
      ],
      ["Review the new placement before accepting."],
      latestFeedback?.id,
    );
  };

  const copyPrompt = async () => {
    await navigator.clipboard.writeText(proposalPrompt(state));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const downloadPlan = () => {
    const current = stateRef.current;
    const plan = {
      product: "HomeWheel",
      disclaimer:
        "Personal planning aid; not accessibility, building-code, or medical certification.",
      scenario: current.scenarioName,
      question: current.question,
      room: current.room,
      mobilityProfile: current.mobility,
      furniture: current.furniture,
      destinations: current.targets,
      metrics: measureLayout(
        current.room,
        current.furniture,
        current.mobility,
        current.targets,
      ),
      humanConstraints: current.furniture
        .filter((item) => item.locked || item.stabilityCritical)
        .map((item) => ({
          object: item.name,
          reason: item.lockReason,
          stabilityCritical: Boolean(item.stabilityCritical),
        })),
      feedback: current.feedback,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(plan, null, 2)], {
        type: "application/json",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `homewheel-${current.scenarioId}-plan.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const openSetup = () => {
    setSetupDraft({
      room: { ...state.room, door: { ...state.room.door } },
      furniture: cloneFurniture(state.furniture),
      targets: cloneTargets(state.targets),
      selectedId: state.selectedId,
    });
    setShowSetup(true);
  };

  const addDraftFurniture = (
    preset: (typeof furniturePresets)[number],
  ) => {
    if (!setupDraft) return;
    const count = setupDraft.furniture.filter(
      (item) => item.kind === preset.kind,
    ).length;
    const item: FurnitureItem = {
      id: `${preset.kind}-${Date.now()}`,
      name: `${preset.name}${count > 0 ? ` ${count + 1}` : ""}`,
      kind: preset.kind,
      x: 20 + ((setupDraft.furniture.length * 35) % 180),
      y: 20 + ((setupDraft.furniture.length * 45) % 180),
      width: preset.width,
      height: preset.height,
      rotation: 0,
      locked: false,
      color: preset.color,
    };
    const clamped = clampFurniture(item, setupDraft.room);
    setSetupDraft({
      ...setupDraft,
      furniture: [...setupDraft.furniture, clamped],
      selectedId: clamped.id,
    });
  };

  const updateDraftFurniture = (
    itemId: string,
    patch: Partial<FurnitureItem>,
  ) => {
    if (!setupDraft) return;
    setSetupDraft({
      ...setupDraft,
      furniture: setupDraft.furniture.map((item) =>
        item.id === itemId
          ? clampFurniture({ ...item, ...patch }, setupDraft.room)
          : item,
      ),
    });
  };

  const removeDraftFurniture = (itemId: string) => {
    if (!setupDraft) return;
    const remaining = setupDraft.furniture.filter(
      (item) => item.id !== itemId,
    );
    setSetupDraft({
      ...setupDraft,
      furniture: remaining,
      targets: setupDraft.targets.filter(
        (target) => target.objectId !== itemId,
      ),
      selectedId: remaining[0]?.id ?? null,
    });
  };

  const toggleDraftDestination = (itemId: string) => {
    if (!setupDraft) return;
    const existing = setupDraft.targets.find(
      (target) => target.objectId === itemId,
    );
    const item = setupDraft.furniture.find(
      (candidate) => candidate.id === itemId,
    );
    if (!item) return;
    setSetupDraft({
      ...setupDraft,
      targets: existing
        ? setupDraft.targets.filter((target) => target.id !== existing.id)
        : [
            ...setupDraft.targets,
            {
              id: `target-${item.id}`,
              label: item.name,
              objectId: item.id,
              side: "left",
              required: true,
              purpose: "reach",
              clearanceDepth: 80,
            },
          ],
    });
  };

  const saveSetup = () => {
    if (!setupDraft || setupDraft.furniture.length === 0) return;
    const current = stateRef.current;
    const room = {
      width: Math.max(300, Math.min(800, setupDraft.room.width)),
      height: Math.max(260, Math.min(650, setupDraft.room.height)),
      door: {
        wall: "bottom" as const,
        width: Math.max(70, Math.min(150, setupDraft.room.door.width)),
        x: Math.max(
          0,
          Math.min(
            setupDraft.room.width - setupDraft.room.door.width,
            setupDraft.room.door.x,
          ),
        ),
      },
    };
    const furniture = setupDraft.furniture.map((item) =>
      clampFurniture(item, room),
    );
    const targets =
      setupDraft.targets.length > 0
        ? setupDraft.targets
        : [
            {
              id: `target-${furniture[0].id}`,
              label: furniture[0].name,
              objectId: furniture[0].id,
              side: "left" as ApproachSide,
              required: true,
              purpose: "reach" as RoutePurpose,
              clearanceDepth: 80,
            },
          ];
    const snapshot = createSnapshot(current, "Before room setup");
    const nextBase: WorkspaceSnapshot = {
      id: "baseline",
      label: "Customized baseline",
      createdAt: new Date().toISOString(),
      scenarioId: current.scenarioId,
      scenarioName: current.scenarioName,
      question: current.question,
      room,
      furniture: cloneFurniture(furniture),
      mobility: {
        ...current.mobility,
        priorities: [...current.mobility.priorities],
      },
      targets: cloneTargets(targets),
      activeTargetId: targets[0].id,
    };
    commit({
      ...current,
      room,
      furniture,
      targets,
      activeTargetId: targets[0].id,
      selectedId: setupDraft.selectedId ?? furniture[0].id,
      baseline: nextBase,
      proposal: null,
      feedback: [],
      history: [...current.history, snapshot].slice(-30),
      activity: [
        createActivity(
          "You",
          "Room setup saved",
          `${room.width} × ${room.height} cm with ${furniture.length} furniture objects and ${targets.length} destinations.`,
        ),
        ...current.activity,
      ].slice(0, 40),
    });
    setShowSetup(false);
  };

  const draftSelected = setupDraft?.furniture.find(
    (item) => item.id === setupDraft.selectedId,
  );
  const draftTarget = setupDraft?.targets.find(
    (target) => target.objectId === draftSelected?.id,
  );
  const currentRoutePolyline = activeRoute?.points
    .map((point) => `${point.x},${point.y}`)
    .join(" ");
  const previewRoutePolyline = activePreviewRoute?.points
    .map((point) => `${point.x},${point.y}`)
    .join(" ");
  const latestFeedback = state.feedback.at(-1);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" role="presentation">
              <path d="M4 14 16 4l12 10v14H4Z" />
              <circle cx="15.5" cy="13" r="2" className="brand-head" />
              <path
                d="M15.5 17v4h4l3 5M15.5 19h4M15.5 21l-2.5 5"
                className="brand-person"
              />
              <path d="M17 26a5 5 0 1 1-3-8" className="brand-wheel" />
            </svg>
          </div>
          <div>
            <div className="brand-name">HomeWheel</div>
            <div className="brand-tagline">Make room for real movement</div>
          </div>
        </div>

        <div className="scenario-picker">
          <LayoutTemplate size={15} />
          <select
            aria-label="Choose a room scenario"
            value={state.scenarioId}
            onChange={(event) => loadScenario(event.target.value)}
          >
            {scenarioTemplates.map((scenario) => (
              <option value={scenario.id} key={scenario.id}>
                {scenario.shortName}
              </option>
            ))}
          </select>
        </div>

        <div className="topbar-actions">
          <div
            className={`tool-status tool-status-${webMcpStatus}`}
            title="The browser exposes HomeWheel actions to compatible agents."
          >
            <span className="status-dot" />
            {webMcpStatus === "available"
              ? "8 WebMCP tools ready"
              : webMcpStatus === "checking"
                ? "Checking WebMCP"
                : "Preview mode"}
          </div>
          <button
            className="button button-quiet"
            onClick={() => setShowHowItWorks(true)}
          >
            <Info size={16} />
            How it works
          </button>
          <button
            className="button button-quiet"
            onClick={() => setShowUserStories(true)}
          >
            <HeartHandshake size={16} />
            Real needs
          </button>
          <button className="button button-quiet" onClick={openSetup}>
            <PencilRuler size={16} />
            Edit room
          </button>
          <button className="button button-quiet" onClick={downloadPlan}>
            <Download size={16} />
            Export
          </button>
          <button
            className="button button-quiet"
            onClick={() =>
              commit({ ...stateRef.current, showBaseline: !state.showBaseline })
            }
          >
            {state.showBaseline ? <EyeOff size={16} /> : <Eye size={16} />}
            {state.showBaseline ? "Hide original" : "Compare"}
          </button>
          <button
            className="button button-quiet"
            onClick={undo}
            disabled={state.history.length === 0}
          >
            <Undo2 size={16} />
            Undo
          </button>
        </div>
      </header>

      <section className="workflow-strip" aria-label="HomeWheel workflow">
        <span className="workflow-step complete">
          <strong>1</strong> Describe real movement
        </span>
        <ArrowRight size={14} />
        <span className={`workflow-step ${state.proposal ? "complete" : ""}`}>
          <strong>2</strong> Agent previews
        </span>
        <ArrowRight size={14} />
        <span className={`workflow-step ${state.proposal ? "active" : ""}`}>
          <strong>3</strong> Person decides
        </span>
      </section>

      <section className="workspace-heading">
        <div>
          <p className="eyebrow">
            {state.scenarioName} · personal circulation
          </p>
          <h1>{state.question}</h1>
          <p className="workspace-description">
            Geometry measures the room. Lived preferences decide what a good
            layout means.
          </p>
        </div>
        <div
          className={`route-summary ${
            visibleMetrics.requiredReachable === visibleMetrics.requiredTotal
              ? "route-clear"
              : "route-blocked"
          } ${state.proposal ? "route-preview" : ""}`}
          role="status"
          aria-live="polite"
        >
          <div className="route-summary-icon">
            {visibleMetrics.requiredReachable ===
            visibleMetrics.requiredTotal ? (
              <Check size={19} />
            ) : (
              <Route size={19} />
            )}
          </div>
          <div>
            <strong>
              {state.proposal ? "Proposal preview" : "Live layout"} ·{" "}
              {visibleMetrics.requiredReachable}/
              {visibleMetrics.requiredTotal} required routes
            </strong>
            <span>
              {visibleMetrics.requiredReachable ===
              visibleMetrics.requiredTotal
                ? "Every required destination is reachable."
                : "At least one required destination remains blocked."}
            </span>
          </div>
        </div>
      </section>

      <section className="workspace-grid">
        <aside className="left-panel panel">
          <div className="panel-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Personal movement profile</p>
                <h2>What works for you</h2>
              </div>
              <Ruler size={18} />
            </div>

            <label className="text-field compact-field">
              <span>Device description</span>
              <input
                value={state.mobility.deviceLabel}
                maxLength={40}
                onChange={(event) =>
                  commit({
                    ...stateRef.current,
                    mobility: {
                      ...stateRef.current.mobility,
                      deviceLabel: event.target.value,
                    },
                    proposal: null,
                  })
                }
              />
            </label>

            <label className="field">
              <span>
                Device width
                <strong>{state.mobility.chairWidth} cm</strong>
              </span>
              <input
                type="range"
                min="45"
                max="110"
                step="1"
                value={state.mobility.chairWidth}
                onChange={(event) =>
                  updateMobility({ chairWidth: Number(event.target.value) })
                }
              />
            </label>

            <label className="field">
              <span>
                Preferred passage
                <strong>{state.mobility.minimumPassage} cm</strong>
              </span>
              <input
                type="range"
                min="65"
                max="150"
                step="5"
                value={state.mobility.minimumPassage}
                onChange={(event) =>
                  updateMobility({
                    minimumPassage: Number(event.target.value),
                  })
                }
              />
            </label>

            <label className="field">
              <span>
                Turning diameter
                <strong>{state.mobility.turningDiameter} cm</strong>
              </span>
              <input
                type="range"
                min="90"
                max="220"
                step="5"
                value={state.mobility.turningDiameter}
                onChange={(event) =>
                  updateMobility({
                    turningDiameter: Number(event.target.value),
                  })
                }
              />
            </label>

            <div className="priority-field">
              <span>What should proposals protect?</span>
              <div className="priority-grid">
                {PRIORITY_OPTIONS.map((option) => {
                  const active = state.mobility.priorities.includes(option.id);
                  return (
                    <button
                      key={option.id}
                      className={active ? "active" : ""}
                      aria-pressed={active}
                      onClick={() =>
                        updateMobility({
                          priorities: active
                            ? state.mobility.priorities.filter(
                                (priority) => priority !== option.id,
                              )
                            : [...state.mobility.priorities, option.id],
                        })
                      }
                    >
                      {active && <Check size={11} />}
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="panel-section">
            <div className="section-heading compact">
              <div>
                <p className="eyebrow">Required destinations</p>
                <h2>Where you need to go</h2>
              </div>
              <MapPin size={17} />
            </div>
            <div className="destination-list">
              {metrics.routes.map((route) => {
                const target = state.targets.find(
                  (candidate) => candidate.id === route.targetId,
                );
                return (
                  <button
                    key={route.targetId}
                    className={`destination ${
                      route.targetId === state.activeTargetId ? "active" : ""
                    }`}
                    onClick={() =>
                      commit({
                        ...stateRef.current,
                        activeTargetId: route.targetId,
                      })
                    }
                  >
                    <span
                      className={`destination-state ${route.status}`}
                      aria-hidden="true"
                    >
                      {route.status === "clear" ? (
                        <Check size={12} />
                      ) : (
                        <X size={12} />
                      )}
                    </span>
                    <span>
                      <strong>{route.targetLabel}</strong>
                      <small>
                        {target ? PURPOSE_LABELS[target.purpose] : "Approach"} ·{" "}
                        {target?.clearanceDepth ?? 0} cm zone ·{" "}
                        {target?.required ? "Required" : "Optional"} ·{" "}
                        {route.status === "clear"
                          ? formatMeters(route.distance)
                          : "Blocked"}
                      </small>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="panel-section">
            <div className="section-heading compact">
              <div>
                <p className="eyebrow">Human constraints</p>
                <h2>Must stay here</h2>
              </div>
              <Lock size={17} />
            </div>
            <div className="constraint-list">
              {state.furniture
                .filter((item) => item.locked || item.stabilityCritical)
                .map((item) => (
                  <button
                    key={item.id}
                    className="constraint"
                    onClick={() =>
                      commit({ ...stateRef.current, selectedId: item.id })
                    }
                  >
                    <span className="constraint-icon">
                      <Lock size={13} />
                    </span>
                    <span>
                      <strong>{item.name}</strong>
                      <small>
                        {item.stabilityCritical && "Stability-critical · "}
                        {item.lockReason}
                      </small>
                    </span>
                  </button>
                ))}
              {!state.furniture.some(
                (item) => item.locked || item.stabilityCritical,
              ) && (
                <p className="empty-state">No protected positions yet.</p>
              )}
            </div>
          </div>

          <div className="responsibility-note">
            <ShieldCheck size={17} />
            <p>
              <strong>Personal simulation, not certification.</strong>
              HomeWheel supports design conversations; it does not certify code
              compliance or medical suitability.
            </p>
          </div>
        </aside>

        <section className="canvas-panel panel">
          <div className="metric-strip">
            <div>
              <span>Reachable</span>
              <strong>
                {visibleMetrics.requiredReachable}/
                {visibleMetrics.requiredTotal}
              </strong>
              {state.proposal && (
                <small>
                  was {metrics.requiredReachable}/{metrics.requiredTotal}
                </small>
              )}
            </div>
            <div>
              <span>Active route</span>
              <strong>
                {visibleActiveRoute?.status === "clear"
                  ? formatMeters(visibleActiveRoute.distance)
                  : "Blocked"}
              </strong>
              <small>{visibleActiveRoute?.targetLabel}</small>
            </div>
            <div>
              <span>Approach zone</span>
              <strong>
                {visibleActiveRoute?.approachZoneClear ? "Clear" : "Blocked"}
              </strong>
              <small>
                {visibleActiveRoute
                  ? `${visibleActiveRoute.approachClearance} cm ${visibleActiveRoute.purpose}`
                  : "Select a destination"}
              </small>
            </div>
            <div>
              <span>Turning space</span>
              <strong>
                {visibleActiveRoute?.turningSpot ? "Found" : "Not found"}
              </strong>
              <small>{state.mobility.turningDiameter} cm diameter</small>
            </div>
          </div>

          <div className="canvas-toolbar">
            <div>
              <span className="live-label">
                <span />
                {state.proposal ? "Proposal overlay" : "Live shared room"}
              </span>
              <p>
                {state.proposal
                  ? "Purple outlines are only a preview. The room has not changed."
                  : "Drag unlocked furniture. Agent proposals appear as previews."}
              </p>
            </div>
            <div className="canvas-legend" aria-label="Room legend">
              <span>
                <i className="legend-route" /> live route
              </span>
              {state.proposal && (
                <span>
                  <i className="legend-proposal" /> proposal
                </span>
              )}
              <span>
                <i className="legend-locked" /> protected
              </span>
            </div>
          </div>

          <div className="room-stage">
            <svg
              className="room-canvas"
              viewBox={`-18 -18 ${state.room.width + 36} ${state.room.height + 42}`}
              role="img"
              aria-label={`${state.scenarioName} plan. ${metrics.requiredReachable} of ${metrics.requiredTotal} required routes are clear.`}
            >
              <defs>
                <pattern
                  id="grid"
                  width="20"
                  height="20"
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d="M 20 0 L 0 0 0 20"
                    fill="none"
                    stroke="rgba(58, 67, 61, .08)"
                    strokeWidth="1"
                  />
                </pattern>
                <filter
                  id="soft-shadow"
                  x="-30%"
                  y="-30%"
                  width="160%"
                  height="160%"
                >
                  <feDropShadow
                    dx="0"
                    dy="4"
                    stdDeviation="4"
                    floodColor="#1d2923"
                    floodOpacity=".14"
                  />
                </filter>
                <marker
                  id="proposal-arrow"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="5"
                  markerHeight="5"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" className="proposal-arrowhead" />
                </marker>
              </defs>

              <rect
                x="0"
                y="0"
                width={state.room.width}
                height={state.room.height}
                rx="5"
                className="room-floor"
              />
              <rect
                x="0"
                y="0"
                width={state.room.width}
                height={state.room.height}
                rx="5"
                fill="url(#grid)"
              />
              <path
                d={`M 0 ${state.room.height} H ${state.room.door.x} M ${
                  state.room.door.x + state.room.door.width
                } ${state.room.height} H ${state.room.width}`}
                className="room-wall"
              />
              <path
                d={`M ${state.room.door.x} ${state.room.height} A ${
                  state.room.door.width
                } ${state.room.door.width} 0 0 1 ${
                  state.room.door.x + state.room.door.width
                } ${state.room.height - state.room.door.width}`}
                className="door-swing"
              />
              <line
                x1={state.room.door.x}
                y1={state.room.height}
                x2={state.room.door.x + state.room.door.width}
                y2={state.room.height - state.room.door.width}
                className="door-leaf"
              />
              <text
                x={state.room.door.x + state.room.door.width / 2}
                y={state.room.height + 17}
                className="room-label"
                textAnchor="middle"
              >
                ENTRY
              </text>

              {state.showBaseline &&
                state.baseline.furniture.map((item) => {
                  const size = getFurnitureDimensions(item);
                  return (
                    <rect
                      key={`baseline-${item.id}`}
                      x={item.x}
                      y={item.y}
                      width={size.width}
                      height={size.height}
                      rx="6"
                      className="baseline-outline"
                    />
                  );
                })}

              {activeApproachZone && (
                <g className="approach-zone-group">
                  <rect
                    x={activeApproachZone.x}
                    y={activeApproachZone.y}
                    width={activeApproachZone.width}
                    height={activeApproachZone.height}
                    rx="7"
                    className={`approach-zone ${
                      visibleActiveRoute?.approachZoneClear
                        ? "approach-zone-clear"
                        : "approach-zone-blocked"
                    }`}
                  />
                  <text
                    x={activeApproachZone.x + activeApproachZone.width / 2}
                    y={activeApproachZone.y + activeApproachZone.height / 2}
                    textAnchor="middle"
                    className="approach-zone-label"
                  >
                    {visibleActiveRoute?.purpose.toUpperCase()} ZONE
                  </text>
                </g>
              )}

              {currentRoutePolyline && (
                <>
                  <polyline
                    points={currentRoutePolyline}
                    className={`route-envelope route-envelope-${
                      activeRoute?.status ?? "blocked"
                    } ${state.proposal ? "route-muted" : ""}`}
                  />
                  <polyline
                    points={currentRoutePolyline}
                    className={`route-line route-line-${
                      activeRoute?.status ?? "blocked"
                    } ${state.proposal ? "route-muted" : ""}`}
                  />
                </>
              )}

              {state.proposal && previewRoutePolyline && (
                <>
                  <polyline
                    points={previewRoutePolyline}
                    className={`proposal-route-envelope proposal-route-${activePreviewRoute?.status}`}
                  />
                  <polyline
                    points={previewRoutePolyline}
                    className={`proposal-route-line proposal-route-${activePreviewRoute?.status}`}
                  />
                </>
              )}

              {visibleActiveRoute?.points[0] && (
                <circle
                  cx={visibleActiveRoute.points[0].x}
                  cy={visibleActiveRoute.points[0].y}
                  r="7"
                  className="route-node route-start"
                />
              )}
              {visibleActiveRoute?.points.at(-1) && (
                <g
                  transform={`translate(${
                    visibleActiveRoute.points.at(-1)!.x
                  }, ${visibleActiveRoute.points.at(-1)!.y})`}
                  className="destination-marker"
                >
                  <circle r="8" />
                  <path d="M-2 0h4M0-2v4" />
                </g>
              )}
              {visibleActiveRoute?.turningSpot && (
                <circle
                  cx={visibleActiveRoute.turningSpot.x}
                  cy={visibleActiveRoute.turningSpot.y}
                  r={state.mobility.turningDiameter / 2}
                  className="turning-circle"
                />
              )}

              {state.furniture.map((item) => {
                const size = getFurnitureDimensions(item);
                const isSelected = item.id === state.selectedId;
                const isProtected =
                  item.locked || Boolean(item.stabilityCritical);
                return (
                  <g
                    key={item.id}
                    className={`furniture ${
                      isProtected ? "furniture-locked" : "furniture-movable"
                    } ${isSelected ? "furniture-selected" : ""} ${
                      state.proposal ? "furniture-previewing" : ""
                    }`}
                    onPointerDown={(event) => handlePointerDown(event, item)}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onKeyDown={(event) => {
                      const directions = {
                        ArrowLeft: "left",
                        ArrowRight: "right",
                        ArrowUp: "up",
                        ArrowDown: "down",
                      } as const;
                      const direction =
                        directions[event.key as keyof typeof directions];
                      if (direction) {
                        event.preventDefault();
                        nudgeFurniture(item, direction);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={`${item.name}, ${
                      isProtected
                        ? "protected"
                        : "movable; use arrow keys to move by five centimeters"
                    }`}
                  >
                    <rect
                      x={item.x}
                      y={item.y}
                      width={size.width}
                      height={size.height}
                      rx={item.kind === "chair" ? 18 : 7}
                      fill={item.color}
                      filter="url(#soft-shadow)"
                      className="furniture-body"
                    />
                    {item.kind === "bed" && (
                      <>
                        <rect
                          x={item.x + 10}
                          y={item.y + 10}
                          width={size.width - 20}
                          height={42}
                          rx="8"
                          className="bed-pillow"
                        />
                        <line
                          x1={item.x + 8}
                          y1={item.y + 61}
                          x2={item.x + size.width - 8}
                          y2={item.y + 61}
                          className="furniture-detail"
                        />
                      </>
                    )}
                    {(item.kind === "dresser" ||
                      item.kind === "wardrobe") &&
                      [0.31, 0.61].map((ratio) => (
                        <line
                          key={ratio}
                          x1={item.x + 7}
                          y1={item.y + size.height * ratio}
                          x2={item.x + size.width - 7}
                          y2={item.y + size.height * ratio}
                          className="furniture-detail"
                        />
                      ))}
                    {(item.kind === "desk" || item.kind === "table") && (
                      <rect
                        x={item.x + 16}
                        y={item.y + 13}
                        width={Math.max(12, size.width - 32)}
                        height={Math.max(10, size.height - 26)}
                        rx="4"
                        className="desk-inset"
                      />
                    )}
                    <text
                      x={item.x + size.width / 2}
                      y={item.y + size.height / 2 + 4}
                      textAnchor="middle"
                      className="furniture-label"
                    >
                      {item.name}
                    </text>
                    {isProtected && (
                      <g
                        transform={`translate(${item.x + size.width - 17}, ${
                          item.y + 8
                        })`}
                      >
                        <circle cx="6" cy="6" r="10" className="lock-bubble" />
                        <path
                          d="M3.5 5.5V4.2A2.5 2.5 0 0 1 8.5 4.2v1.3M2.7 5.5h6.6v5H2.7z"
                          className="lock-glyph"
                        />
                      </g>
                    )}
                  </g>
                );
              })}

              {state.proposal &&
                state.proposal.moves.map((move) => {
                  const current = state.furniture.find(
                    (item) => item.id === move.objectId,
                  );
                  const proposed = state.proposal!.previewFurniture.find(
                    (item) => item.id === move.objectId,
                  );
                  if (!current || !proposed) return null;
                  const currentSize = getFurnitureDimensions(current);
                  const proposedSize = getFurnitureDimensions(proposed);
                  const start = {
                    x: current.x + currentSize.width / 2,
                    y: current.y + currentSize.height / 2,
                  };
                  const end = {
                    x: proposed.x + proposedSize.width / 2,
                    y: proposed.y + proposedSize.height / 2,
                  };
                  return (
                    <g key={`proposal-${move.objectId}`}>
                      <line
                        x1={start.x}
                        y1={start.y}
                        x2={end.x}
                        y2={end.y}
                        className="proposal-arrow"
                        markerEnd="url(#proposal-arrow)"
                      />
                      <rect
                        x={proposed.x}
                        y={proposed.y}
                        width={proposedSize.width}
                        height={proposedSize.height}
                        rx="7"
                        className="proposal-object"
                      />
                      <text
                        x={end.x}
                        y={end.y + 4}
                        textAnchor="middle"
                        className="proposal-label"
                      >
                        {proposed.name}
                      </text>
                    </g>
                  );
                })}

              <g transform={`translate(${state.room.width - 63}, 10)`}>
                <rect width="52" height="21" rx="10.5" className="scale-bg" />
                <line x1="9" y1="11" x2="39" y2="11" className="scale-line" />
                <line x1="9" y1="7" x2="9" y2="15" className="scale-line" />
                <line x1="39" y1="7" x2="39" y2="15" className="scale-line" />
                <text x="24" y="8" textAnchor="middle" className="scale-text">
                  1 m
                </text>
              </g>
            </svg>
          </div>

          <div className="selected-bar">
            {selected ? (
              <>
                <span
                  className="object-swatch"
                  style={{ background: selected.color }}
                />
                <div>
                  <strong>{selected.name}</strong>
                  <small>
                    {Math.round(selected.x)} × {Math.round(selected.y)} cm
                    {(selected.locked || selected.stabilityCritical) &&
                      ` · ${selected.lockReason}`}
                  </small>
                </div>
                <button
                  className="button button-small"
                  onClick={rotateSelected}
                  disabled={
                    selected.locked ||
                    selected.stabilityCritical ||
                    Boolean(state.proposal)
                  }
                >
                  <RefreshCcw size={14} />
                  Rotate
                </button>
                <button
                  className="button button-small"
                  onClick={toggleSelectedLock}
                  disabled={Boolean(state.proposal)}
                >
                  {selected.locked || selected.stabilityCritical ? (
                    <LockOpen size={14} />
                  ) : (
                    <Lock size={14} />
                  )}
                  {selected.locked || selected.stabilityCritical
                    ? "Allow move"
                    : "Protect"}
                </button>
              </>
            ) : (
              <span>Select an object to inspect its position.</span>
            )}
          </div>
        </section>

        <aside className="right-panel panel">
          {state.proposal ? (
            <div className="proposal-card">
              <div className="proposal-card-header">
                <span className="agent-icon">
                  <Sparkles size={16} />
                </span>
                <div>
                  <p className="eyebrow">Agent proposal · preview only</p>
                  <h2>{state.proposal.title}</h2>
                </div>
              </div>
              <p className="proposal-rationale">{state.proposal.rationale}</p>
              <div className="proposal-score">
                <div>
                  <small>Required routes</small>
                  <strong>
                    {state.proposal.beforeMetrics.requiredReachable}/
                    {state.proposal.beforeMetrics.requiredTotal}
                  </strong>
                </div>
                <ArrowRight size={17} />
                <div className="proposal-score-after">
                  <small>Preview</small>
                  <strong>
                    {state.proposal.afterMetrics.requiredReachable}/
                    {state.proposal.afterMetrics.requiredTotal}
                  </strong>
                </div>
              </div>
              <div className="proposal-moves">
                {state.proposal.moves.map((move) => {
                  const item = state.furniture.find(
                    (candidate) => candidate.id === move.objectId,
                  );
                  return (
                    <div key={move.objectId}>
                      <Move size={14} />
                      <span>
                        <strong>{item?.name ?? move.objectId}</strong>
                        <small>{move.reason}</small>
                      </span>
                    </div>
                  );
                })}
              </div>
              {state.proposal.tradeoffs.length > 0 && (
                <div className="tradeoffs">
                  <strong>Trade-offs to review</strong>
                  {state.proposal.tradeoffs.map((tradeoff) => (
                    <span key={tradeoff}>{tradeoff}</span>
                  ))}
                </div>
              )}
              {!showFeedback ? (
                <div className="proposal-actions">
                  <button
                    className="button button-secondary"
                    onClick={() => setShowFeedback(true)}
                  >
                    Needs revision
                  </button>
                  <button
                    className="button button-primary"
                    onClick={acceptProposal}
                  >
                    <Check size={16} />
                    Accept plan
                  </button>
                </div>
              ) : (
                <div className="feedback-form">
                  <label>
                    What did the geometry miss?
                    <textarea
                      autoFocus
                      value={feedbackDraft}
                      onChange={(event) =>
                        setFeedbackDraft(event.target.value)
                      }
                      placeholder="For example: the drawers must keep facing the bed."
                      maxLength={240}
                    />
                  </label>
                  <div className="feedback-suggestions">
                    {FEEDBACK_SUGGESTIONS.map((suggestion) => (
                      <button
                        key={suggestion}
                        onClick={() => setFeedbackDraft(suggestion)}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                  <div className="proposal-actions">
                    <button
                      className="button button-secondary"
                      onClick={() => setShowFeedback(false)}
                    >
                      Back
                    </button>
                    <button
                      className="button button-primary"
                      disabled={!feedbackDraft.trim()}
                      onClick={rejectProposal}
                    >
                      Request revision
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="agent-prompt-card">
              <div className="prompt-title">
                <span className="agent-icon">
                  <Sparkles size={16} />
                </span>
                <div>
                  <p className="eyebrow">
                    {latestFeedback
                      ? "Revision context ready"
                      : "Try with your browser agent"}
                  </p>
                  <h2>
                    {latestFeedback
                      ? "Replan around lived feedback"
                      : "Ask for a safe preview"}
                  </h2>
                </div>
              </div>
              <p>{proposalPrompt(state)}</p>
              {latestFeedback && (
                <div className="feedback-memory">
                  <UserRound size={14} />
                  <span>
                    <strong>Latest feedback</strong>
                    {latestFeedback.reason}
                  </span>
                </div>
              )}
              <button className="button button-primary" onClick={copyPrompt}>
                {copied ? <Check size={16} /> : <Clipboard size={16} />}
                {copied ? "Copied" : "Copy agent prompt"}
              </button>
              <button
                className="guided-preview"
                onClick={guidedProposal}
                disabled={
                  metrics.requiredReachable === metrics.requiredTotal &&
                  !latestFeedback
                }
              >
                Preview the review flow without an agent
                <ArrowRight size={14} />
              </button>
            </div>
          )}

          <div className="insight-card">
            <div className="insight-heading">
              <Waypoints size={18} />
              <strong>Route evidence</strong>
              <span
                className={
                  metrics.requiredReachable === metrics.requiredTotal
                    ? "status-pill clear"
                    : "status-pill blocked"
                }
              >
                {metrics.requiredReachable}/{metrics.requiredTotal}
              </span>
            </div>
            <div className="route-evidence-list">
              {metrics.routes.map((route) => (
                <button
                  key={route.targetId}
                  onClick={() =>
                    commit({
                      ...stateRef.current,
                      activeTargetId: route.targetId,
                    })
                  }
                >
                  {route.status === "clear" ? (
                    <CircleCheck size={15} />
                  ) : (
                    <CircleAlert size={15} />
                  )}
                  <span>
                    <strong>{route.targetLabel}</strong>
                    <small>
                      {route.status === "clear"
                        ? `${formatMeters(route.distance)} · ${
                            route.turningSpot
                              ? "turning spot"
                              : "no turning spot"
                          }`
                        : route.message}
                    </small>
                  </span>
                </button>
              ))}
            </div>
            {barriers.length > 0 && (
              <div className="barrier-row">
                <span className="barrier-dot" />
                <div>
                  <strong>{barriers[0].name}</strong>
                  <small>
                    Removing this barrier improves{" "}
                    {barriers[0].reachableGain} required route
                    {barriers[0].reachableGain === 1 ? "" : "s"}
                  </small>
                </div>
              </div>
            )}
          </div>

          <div className="activity-section">
            <div className="section-heading compact">
              <div>
                <p className="eyebrow">Shared history</p>
                <h2>Every decision is visible</h2>
              </div>
              <History size={17} />
            </div>

            <div className="activity-list">
              {state.activity.slice(0, 6).map((item) => (
                <div className="activity-item" key={item.id}>
                  <div
                    className={`activity-avatar activity-${item.actor.toLowerCase()}`}
                  >
                    {item.actor === "Agent" ? (
                      <Bot size={14} />
                    ) : item.actor === "You" ? (
                      <UserRound size={14} />
                    ) : (
                      <Info size={14} />
                    )}
                  </div>
                  <div>
                    <div className="activity-meta">
                      <strong>{item.title}</strong>
                      <span>{formatTime(item.at)}</span>
                    </div>
                    <p>{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button className="reset-link" onClick={resetScenario}>
            <RotateCcw size={14} />
            Reset this scenario
          </button>
        </aside>
      </section>

      <footer className="footer">
        <span>
          <Move size={14} /> Direct manipulation
        </span>
        <span>
          <Bot size={14} /> Agent proposals, never silent edits
        </span>
        <span>
          <ShieldCheck size={14} /> Human feedback persists
        </span>
      </footer>

      {showHowItWorks && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setShowHowItWorks(false)}
        >
          <section
            className="how-modal modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="how-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              className="modal-close"
              aria-label="Close"
              onClick={() => setShowHowItWorks(false)}
            >
              <X size={18} />
            </button>
            <p className="eyebrow">Human authority by design</p>
            <h2 id="how-title">The agent optimizes geometry. You define good.</h2>
            <div className="how-steps">
              <div>
                <strong>1</strong>
                <span>
                  <b>Describe real movement</b>
                  Set device width, preferred passage, destinations, and
                  furniture that cannot move.
                </span>
              </div>
              <div>
                <strong>2</strong>
                <span>
                  <b>Review a proposal</b>
                  The agent previews exact moves and measurable route changes.
                  Nothing changes silently.
                </span>
              </div>
              <div>
                <strong>3</strong>
                <span>
                  <b>Accept or teach</b>
                  Approve the plan or reject it with a lived constraint. That
                  feedback becomes structured context for the next proposal.
                </span>
              </div>
            </div>
            <div className="responsibility-note wide-note">
              <ShieldCheck size={17} />
              <p>
                <strong>HomeWheel is a conversation aid.</strong>
                It does not replace occupational therapists, access consultants,
                local codes, or on-site testing by the person who will use the
                room.
              </p>
            </div>
          </section>
        </div>
      )}

      {showUserStories && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setShowUserStories(false)}
        >
          <section
            className="stories-modal modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="stories-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              className="modal-close"
              aria-label="Close real needs"
              onClick={() => setShowUserStories(false)}
            >
              <X size={18} />
            </button>
            <p className="eyebrow">Evidence-grounded user stories</p>
            <h2 id="stories-title">The geometry starts with lived needs.</h2>
            <p className="stories-intro">
              These are composite design scenarios derived from public
              wheelchair-user accounts and research—not testimonials from
              HomeWheel users.
            </p>
            <div className="story-grid">
              {evidenceGroundedStories.map((story, index) => (
                <article className="story-card" key={story.id}>
                  <div className="story-card-heading">
                    <span>{index + 1}</span>
                    <h3>{story.title}</h3>
                  </div>
                  <blockquote>{story.story}</blockquote>
                  <div className="story-response">
                    <strong>How HomeWheel responds</strong>
                    <p>{story.designResponse}</p>
                  </div>
                  <div className="story-sources">
                    {story.sources.map((source) => (
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                        key={source.url}
                      >
                        {source.label}
                        <ExternalLink size={11} />
                      </a>
                    ))}
                  </div>
                </article>
              ))}
            </div>
            <div className="responsibility-note wide-note">
              <ShieldCheck size={17} />
              <p>
                <strong>Evidence informs the prototype; people validate it.</strong>
                Future design decisions should include disabled participants
                directly and compensate them for their expertise.
              </p>
            </div>
          </section>
        </div>
      )}

      {showSetup && setupDraft && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setShowSetup(false)}
        >
          <section
            className="setup-modal modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="setup-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="setup-header">
              <div>
                <p className="eyebrow">Room setup</p>
                <h2 id="setup-title">Make the scenario yours</h2>
              </div>
              <button
                className="modal-close"
                aria-label="Close room setup"
                onClick={() => setShowSetup(false)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="setup-grid">
              <div className="setup-column">
                <h3>Room geometry</h3>
                <div className="number-grid">
                  <label className="text-field">
                    <span>Width (cm)</span>
                    <input
                      type="number"
                      min="300"
                      max="800"
                      value={setupDraft.room.width}
                      onChange={(event) =>
                        setSetupDraft({
                          ...setupDraft,
                          room: {
                            ...setupDraft.room,
                            width: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </label>
                  <label className="text-field">
                    <span>Depth (cm)</span>
                    <input
                      type="number"
                      min="260"
                      max="650"
                      value={setupDraft.room.height}
                      onChange={(event) =>
                        setSetupDraft({
                          ...setupDraft,
                          room: {
                            ...setupDraft.room,
                            height: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </label>
                  <label className="text-field">
                    <span>Door position (cm)</span>
                    <input
                      type="number"
                      min="0"
                      value={setupDraft.room.door.x}
                      onChange={(event) =>
                        setSetupDraft({
                          ...setupDraft,
                          room: {
                            ...setupDraft.room,
                            door: {
                              ...setupDraft.room.door,
                              x: Number(event.target.value),
                            },
                          },
                        })
                      }
                    />
                  </label>
                  <label className="text-field">
                    <span>Door width (cm)</span>
                    <input
                      type="number"
                      min="70"
                      max="150"
                      value={setupDraft.room.door.width}
                      onChange={(event) =>
                        setSetupDraft({
                          ...setupDraft,
                          room: {
                            ...setupDraft.room,
                            door: {
                              ...setupDraft.room.door,
                              width: Number(event.target.value),
                            },
                          },
                        })
                      }
                    />
                  </label>
                </div>

                <h3>Furniture library</h3>
                <div className="furniture-library">
                  {furniturePresets.map((preset) => (
                    <button
                      key={preset.kind}
                      onClick={() => addDraftFurniture(preset)}
                    >
                      <Plus size={14} />
                      {preset.name}
                    </button>
                  ))}
                </div>

                <h3>Objects</h3>
                <div className="setup-object-list">
                  {setupDraft.furniture.map((item) => (
                    <button
                      key={item.id}
                      className={
                        item.id === setupDraft.selectedId ? "active" : ""
                      }
                      onClick={() =>
                        setSetupDraft({
                          ...setupDraft,
                          selectedId: item.id,
                        })
                      }
                    >
                      <i style={{ background: item.color }} />
                      <span>
                        <strong>{item.name}</strong>
                        <small>
                          {item.width} × {item.height} cm
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="setup-column inspector-column">
                {draftSelected ? (
                  <>
                    <div className="inspector-title">
                      <span
                        className="object-swatch large"
                        style={{ background: draftSelected.color }}
                      />
                      <div>
                        <p className="eyebrow">Selected object</p>
                        <h3>{draftSelected.name}</h3>
                      </div>
                    </div>
                    <label className="text-field">
                      <span>Name</span>
                      <input
                        value={draftSelected.name}
                        onChange={(event) =>
                          updateDraftFurniture(draftSelected.id, {
                            name: event.target.value,
                          })
                        }
                      />
                    </label>
                    <div className="number-grid">
                      <label className="text-field">
                        <span>X position</span>
                        <input
                          type="number"
                          value={draftSelected.x}
                          onChange={(event) =>
                            updateDraftFurniture(draftSelected.id, {
                              x: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                      <label className="text-field">
                        <span>Y position</span>
                        <input
                          type="number"
                          value={draftSelected.y}
                          onChange={(event) =>
                            updateDraftFurniture(draftSelected.id, {
                              y: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                      <label className="text-field">
                        <span>Width</span>
                        <input
                          type="number"
                          min="30"
                          value={draftSelected.width}
                          onChange={(event) =>
                            updateDraftFurniture(draftSelected.id, {
                              width: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                      <label className="text-field">
                        <span>Depth</span>
                        <input
                          type="number"
                          min="30"
                          value={draftSelected.height}
                          onChange={(event) =>
                            updateDraftFurniture(draftSelected.id, {
                              height: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                    </div>
                    <div className="inspector-actions">
                      <button
                        className="button button-secondary"
                        onClick={() =>
                          updateDraftFurniture(draftSelected.id, {
                            rotation:
                              draftSelected.rotation === 0 ? 90 : 0,
                          })
                        }
                      >
                        <RefreshCcw size={14} />
                        Rotate 90°
                      </button>
                      <button
                        className="button button-danger"
                        onClick={() =>
                          removeDraftFurniture(draftSelected.id)
                        }
                      >
                        <Trash2 size={14} />
                        Remove
                      </button>
                    </div>
                    <label className="checkbox-field stability-field">
                      <input
                        type="checkbox"
                        checked={Boolean(draftSelected.stabilityCritical)}
                        onChange={(event) =>
                          updateDraftFurniture(draftSelected.id, {
                            stabilityCritical: event.target.checked,
                            locked: event.target.checked
                              ? true
                              : draftSelected.locked,
                            lockReason: event.target.checked
                              ? draftSelected.lockReason ??
                                "Stability-critical during transfers"
                              : draftSelected.lockReason,
                          })
                        }
                      />
                      Stability-critical during transfers or daily use
                    </label>

                    <div className="destination-editor">
                      <div>
                        <strong>Route destination</strong>
                        <small>
                          Include this object in the accessibility check.
                        </small>
                      </div>
                      <button
                        className={`switch-button ${
                          draftTarget ? "active" : ""
                        }`}
                        aria-pressed={Boolean(draftTarget)}
                        onClick={() =>
                          toggleDraftDestination(draftSelected.id)
                        }
                      >
                        {draftTarget ? "Included" : "Not included"}
                      </button>
                    </div>
                    {draftTarget && (
                      <div className="destination-options">
                        <label className="text-field">
                          <span>Activity at destination</span>
                          <select
                            value={draftTarget.purpose}
                            onChange={(event) =>
                              setSetupDraft({
                                ...setupDraft,
                                targets: setupDraft.targets.map((target) =>
                                  target.id === draftTarget.id
                                    ? {
                                        ...target,
                                        purpose: event.target
                                          .value as RoutePurpose,
                                      }
                                    : target,
                                ),
                              })
                            }
                          >
                            <option value="transfer">Transfer</option>
                            <option value="work">Work</option>
                            <option value="reach">Reach</option>
                          </select>
                        </label>
                        <label className="text-field">
                          <span>Approach side</span>
                          <select
                            value={draftTarget.side}
                            onChange={(event) =>
                              setSetupDraft({
                                ...setupDraft,
                                targets: setupDraft.targets.map((target) =>
                                  target.id === draftTarget.id
                                    ? {
                                        ...target,
                                        side: event.target
                                          .value as ApproachSide,
                                      }
                                    : target,
                                ),
                              })
                            }
                          >
                            <option value="left">Left</option>
                            <option value="right">Right</option>
                            <option value="top">Top</option>
                            <option value="bottom">Bottom</option>
                          </select>
                        </label>
                        <label className="text-field">
                          <span>Clear depth (cm)</span>
                          <input
                            type="number"
                            min="60"
                            max="180"
                            step="5"
                            value={draftTarget.clearanceDepth}
                            onChange={(event) =>
                              setSetupDraft({
                                ...setupDraft,
                                targets: setupDraft.targets.map((target) =>
                                  target.id === draftTarget.id
                                    ? {
                                        ...target,
                                        clearanceDepth: Math.max(
                                          60,
                                          Math.min(
                                            180,
                                            Number(event.target.value),
                                          ),
                                        ),
                                      }
                                    : target,
                                ),
                              })
                            }
                          />
                        </label>
                        <label className="checkbox-field">
                          <input
                            type="checkbox"
                            checked={draftTarget.required}
                            onChange={(event) =>
                              setSetupDraft({
                                ...setupDraft,
                                targets: setupDraft.targets.map((target) =>
                                  target.id === draftTarget.id
                                    ? {
                                        ...target,
                                        required: event.target.checked,
                                      }
                                    : target,
                                ),
                              })
                            }
                          />
                          Required destination
                        </label>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="empty-state">Add or select an object.</p>
                )}
              </div>
            </div>

            <div className="setup-footer">
              <p>
                Saving creates a new baseline for comparison. Route checks
                update immediately.
              </p>
              <div>
                <button
                  className="button button-secondary"
                  onClick={() => setShowSetup(false)}
                >
                  Cancel
                </button>
                <button className="button button-primary" onClick={saveSetup}>
                  <Check size={16} />
                  Save room
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
