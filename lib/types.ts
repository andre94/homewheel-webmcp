export type FurnitureKind =
  | "bed"
  | "dresser"
  | "desk"
  | "nightstand"
  | "chair"
  | "sofa"
  | "wardrobe"
  | "table"
  | "shelf";

export type ApproachSide = "left" | "right" | "top" | "bottom";
export type RoutePurpose = "transfer" | "work" | "reach";
export type MovementPriority =
  | "transfer-safety"
  | "fewest-moves"
  | "daily-reach"
  | "daylight";

export type FurnitureItem = {
  id: string;
  name: string;
  kind: FurnitureKind;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: 0 | 90;
  locked: boolean;
  lockReason?: string;
  stabilityCritical?: boolean;
  color: string;
};

export type MobilityProfile = {
  deviceLabel: string;
  chairWidth: number;
  minimumPassage: number;
  turningDiameter: number;
  priorities: MovementPriority[];
};

export type Room = {
  width: number;
  height: number;
  door: {
    wall: "bottom";
    x: number;
    width: number;
  };
};

export type Point = {
  x: number;
  y: number;
};

export type RouteTarget = {
  id: string;
  label: string;
  objectId: string;
  side: ApproachSide;
  required: boolean;
  purpose: RoutePurpose;
  clearanceDepth: number;
};

export type RouteResult = {
  targetId: string;
  targetLabel: string;
  status: "clear" | "blocked";
  points: Point[];
  distance: number;
  minimumClearance: number;
  turningSpot: Point | null;
  approachZoneClear: boolean;
  approachClearance: number;
  purpose: RoutePurpose;
  message: string;
};

export type LayoutMetrics = {
  reachable: number;
  total: number;
  requiredReachable: number;
  requiredTotal: number;
  totalDistance: number;
  routesWithTurningSpace: number;
  routes: RouteResult[];
};

export type WorkspaceSnapshot = {
  id: string;
  label: string;
  createdAt: string;
  scenarioId: string;
  scenarioName: string;
  question: string;
  room: Room;
  furniture: FurnitureItem[];
  mobility: MobilityProfile;
  targets: RouteTarget[];
  activeTargetId: string;
};

export type ActivityItem = {
  id: string;
  actor: "You" | "Agent" | "System";
  title: string;
  detail: string;
  at: string;
  reversible: boolean;
};

export type ProposalMove = {
  objectId: string;
  x: number;
  y: number;
  rotation: 0 | 90;
  reason: string;
};

export type LayoutProposal = {
  id: string;
  title: string;
  rationale: string;
  moves: ProposalMove[];
  tradeoffs: string[];
  createdAt: string;
  previewFurniture: FurnitureItem[];
  beforeMetrics: LayoutMetrics;
  afterMetrics: LayoutMetrics;
  respondsToFeedbackId?: string;
};

export type ProposalFeedback = {
  id: string;
  proposalId: string;
  proposalTitle: string;
  reason: string;
  createdAt: string;
};

export type WorkspaceState = {
  version: 2;
  scenarioId: string;
  scenarioName: string;
  question: string;
  room: Room;
  furniture: FurnitureItem[];
  mobility: MobilityProfile;
  targets: RouteTarget[];
  activeTargetId: string;
  baseline: WorkspaceSnapshot;
  history: WorkspaceSnapshot[];
  activity: ActivityItem[];
  proposal: LayoutProposal | null;
  feedback: ProposalFeedback[];
  showBaseline: boolean;
  selectedId: string | null;
};

export type ScenarioTemplate = {
  id: string;
  name: string;
  shortName: string;
  description: string;
  question: string;
  room: Room;
  furniture: FurnitureItem[];
  mobility: MobilityProfile;
  targets: RouteTarget[];
  selectedId: string | null;
};

export type WebMcpStatus = "available" | "unavailable" | "checking";
