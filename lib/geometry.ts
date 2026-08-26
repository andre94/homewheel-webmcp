import type {
  FurnitureItem,
  LayoutMetrics,
  MobilityProfile,
  Point,
  ProposalMove,
  Room,
  RouteResult,
  RouteTarget,
} from "./types";

const GRID = 10;

type GridPoint = {
  col: number;
  row: number;
};

export type ApproachZone = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const keyOf = ({ col, row }: GridPoint) => `${col}:${row}`;

const distance = (a: GridPoint, b: GridPoint) =>
  Math.abs(a.col - b.col) + Math.abs(a.row - b.row);

export function getFurnitureDimensions(item: FurnitureItem) {
  return item.rotation === 90
    ? { width: item.height, height: item.width }
    : { width: item.width, height: item.height };
}

export function clampFurniture(item: FurnitureItem, room: Room) {
  const { width, height } = getFurnitureDimensions(item);
  return {
    ...item,
    x: Math.max(0, Math.min(room.width - width, item.x)),
    y: Math.max(0, Math.min(room.height - height, item.y)),
  };
}

export function objectsOverlap(a: FurnitureItem, b: FurnitureItem) {
  const aSize = getFurnitureDimensions(a);
  const bSize = getFurnitureDimensions(b);
  return !(
    a.x + aSize.width <= b.x ||
    b.x + bSize.width <= a.x ||
    a.y + aSize.height <= b.y ||
    b.y + bSize.height <= a.y
  );
}

export function getApproachZone(
  furniture: FurnitureItem[],
  mobility: MobilityProfile,
  target: RouteTarget,
): ApproachZone | null {
  const item = furniture.find((candidate) => candidate.id === target.objectId);
  if (!item) return null;

  const dimensions = getFurnitureDimensions(item);
  const depth = Math.max(target.clearanceDepth, mobility.chairWidth + 10);
  const span = Math.max(
    mobility.chairWidth + 20,
    target.purpose === "transfer" ? 100 : 80,
  );

  if (target.side === "left" || target.side === "right") {
    return {
      x:
        target.side === "left"
          ? item.x - depth
          : item.x + dimensions.width,
      y: item.y + dimensions.height / 2 - span / 2,
      width: depth,
      height: span,
    };
  }

  return {
    x: item.x + dimensions.width / 2 - span / 2,
    y:
      target.side === "top"
        ? item.y - depth
        : item.y + dimensions.height,
    width: span,
    height: depth,
  };
}

function rectanglesOverlap(
  first: ApproachZone,
  second: ApproachZone,
) {
  return !(
    first.x + first.width <= second.x ||
    second.x + second.width <= first.x ||
    first.y + first.height <= second.y ||
    second.y + second.height <= first.y
  );
}

function isApproachZoneClear(
  zone: ApproachZone | null,
  room: Room,
  furniture: FurnitureItem[],
  targetObjectId: string,
) {
  if (!zone) return false;
  if (
    zone.x < 0 ||
    zone.y < 0 ||
    zone.x + zone.width > room.width ||
    zone.y + zone.height > room.height
  ) {
    return false;
  }

  return !furniture
    .filter((item) => item.id !== targetObjectId)
    .some((item) => {
      const size = getFurnitureDimensions(item);
      return rectanglesOverlap(zone, {
        x: item.x,
        y: item.y,
        width: size.width,
        height: size.height,
      });
    });
}

function getRouteEndpoints(
  room: Room,
  furniture: FurnitureItem[],
  mobility: MobilityProfile,
  target: RouteTarget,
) {
  const start = {
    x: room.door.x + room.door.width / 2,
    y: room.height - 10,
  };
  const item = furniture.find((candidate) => candidate.id === target.objectId);

  if (!item) {
    return { start, goal: { x: room.width / 2, y: room.height / 2 } };
  }

  const dimensions = getFurnitureDimensions(item);
  const offset = Math.max(
    mobility.chairWidth / 2 + 10,
    mobility.minimumPassage / 2 + 5,
  );
  const centers = {
    left: { x: item.x - offset, y: item.y + dimensions.height / 2 },
    right: {
      x: item.x + dimensions.width + offset,
      y: item.y + dimensions.height / 2,
    },
    top: { x: item.x + dimensions.width / 2, y: item.y - offset },
    bottom: {
      x: item.x + dimensions.width / 2,
      y: item.y + dimensions.height + offset,
    },
  };

  return { start, goal: centers[target.side] };
}

function isBlockedWithRadius(
  point: Point,
  radius: number,
  room: Room,
  furniture: FurnitureItem[],
) {
  if (
    point.x < radius ||
    point.y < radius ||
    point.x > room.width - radius ||
    point.y > room.height - radius
  ) {
    const inDoorOpening =
      point.y > room.height - radius - 20 &&
      point.x > room.door.x &&
      point.x < room.door.x + room.door.width;
    if (!inDoorOpening) return true;
  }

  return furniture.some((item) => {
    const dimensions = getFurnitureDimensions(item);
    return (
      point.x >= item.x - radius &&
      point.x <= item.x + dimensions.width + radius &&
      point.y >= item.y - radius &&
      point.y <= item.y + dimensions.height + radius
    );
  });
}

function isBlocked(
  point: Point,
  room: Room,
  furniture: FurnitureItem[],
  mobility: MobilityProfile,
) {
  const radius = Math.max(
    mobility.chairWidth / 2,
    mobility.minimumPassage / 2,
  );
  return isBlockedWithRadius(point, radius, room, furniture);
}

function nearestOpenGridPoint(
  point: Point,
  room: Room,
  furniture: FurnitureItem[],
  mobility: MobilityProfile,
) {
  const base = {
    col: Math.round(point.x / GRID),
    row: Math.round(point.y / GRID),
  };

  for (let ring = 0; ring <= 14; ring += 1) {
    for (let dc = -ring; dc <= ring; dc += 1) {
      for (let dr = -ring; dr <= ring; dr += 1) {
        if (Math.abs(dc) !== ring && Math.abs(dr) !== ring) continue;
        const candidate = { col: base.col + dc, row: base.row + dr };
        const world = { x: candidate.col * GRID, y: candidate.row * GRID };
        if (
          candidate.col >= 0 &&
          candidate.row >= 0 &&
          world.x <= room.width &&
          world.y <= room.height &&
          !isBlocked(world, room, furniture, mobility)
        ) {
          return candidate;
        }
      }
    }
  }
  return null;
}

function simplifyPath(points: Point[]) {
  if (points.length < 3) return points;
  const simplified = [points[0]];

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = simplified[simplified.length - 1];
    const current = points[index];
    const next = points[index + 1];
    const sameHorizontal =
      previous.y === current.y && current.y === next.y;
    const sameVertical = previous.x === current.x && current.x === next.x;
    if (!sameHorizontal && !sameVertical) simplified.push(current);
  }

  simplified.push(points[points.length - 1]);
  return simplified;
}

function pointToRectangleDistance(point: Point, item: FurnitureItem) {
  const size = getFurnitureDimensions(item);
  const dx = Math.max(item.x - point.x, 0, point.x - (item.x + size.width));
  const dy = Math.max(item.y - point.y, 0, point.y - (item.y + size.height));
  return Math.sqrt(dx * dx + dy * dy);
}

function estimateMinimumClearance(
  path: Point[],
  room: Room,
  furniture: FurnitureItem[],
  targetObjectId: string,
) {
  if (path.length < 2) return 0;
  let smallest = Number.POSITIVE_INFINITY;

  for (const point of path.slice(0, -1)) {
    const wallDistance = Math.min(
      point.x,
      point.y,
      room.width - point.x,
      room.height - point.y,
    );
    const obstacleDistance = furniture
      .filter((item) => item.id !== targetObjectId)
      .reduce(
        (minimum, item) =>
          Math.min(minimum, pointToRectangleDistance(point, item)),
        Number.POSITIVE_INFINITY,
      );
    smallest = Math.min(smallest, wallDistance * 2, obstacleDistance * 2);
  }

  return Number.isFinite(smallest) ? Math.max(0, Math.round(smallest)) : 0;
}

function findTurningSpot(
  gridPath: GridPoint[],
  room: Room,
  furniture: FurnitureItem[],
  mobility: MobilityProfile,
) {
  const radius = mobility.turningDiameter / 2;
  for (let index = 0; index < gridPath.length; index += 2) {
    const point = {
      x: gridPath[index].col * GRID,
      y: gridPath[index].row * GRID,
    };
    if (!isBlockedWithRadius(point, radius, room, furniture)) return point;
  }
  return null;
}

export function simulateRoute(
  room: Room,
  furniture: FurnitureItem[],
  mobility: MobilityProfile,
  target: RouteTarget,
): RouteResult {
  const approachZone = getApproachZone(furniture, mobility, target);
  const approachZoneClear = isApproachZoneClear(
    approachZone,
    room,
    furniture,
    target.objectId,
  );
  const { start, goal } = getRouteEndpoints(
    room,
    furniture,
    mobility,
    target,
  );
  const startGrid = nearestOpenGridPoint(start, room, furniture, mobility);
  const goalGrid = nearestOpenGridPoint(goal, room, furniture, mobility);

  if (!startGrid || !goalGrid) {
    return {
      targetId: target.id,
      targetLabel: target.label,
      status: "blocked",
      points: [start, goal],
      distance: 0,
      minimumClearance: 0,
      turningSpot: null,
      approachZoneClear,
      approachClearance: target.clearanceDepth,
      purpose: target.purpose,
      message: "No usable start or approach area is available.",
    };
  }

  if (!approachZoneClear) {
    return {
      targetId: target.id,
      targetLabel: target.label,
      status: "blocked",
      points: [start, goal],
      distance: 0,
      minimumClearance: 0,
      turningSpot: null,
      approachZoneClear: false,
      approachClearance: target.clearanceDepth,
      purpose: target.purpose,
      message: `The ${target.purpose} zone needs ${target.clearanceDepth} cm of clear depth on the ${target.side} side.`,
    };
  }

  const open = new Map<string, GridPoint>([[keyOf(startGrid), startGrid]]);
  const cameFrom = new Map<string, GridPoint>();
  const gScore = new Map<string, number>([[keyOf(startGrid), 0]]);
  const fScore = new Map<string, number>([
    [keyOf(startGrid), distance(startGrid, goalGrid)],
  ]);
  const maxCols = Math.floor(room.width / GRID);
  const maxRows = Math.floor(room.height / GRID);
  let found: GridPoint | null = null;

  while (open.size > 0) {
    const current = [...open.values()].sort(
      (a, b) =>
        (fScore.get(keyOf(a)) ?? Number.POSITIVE_INFINITY) -
        (fScore.get(keyOf(b)) ?? Number.POSITIVE_INFINITY),
    )[0];

    if (keyOf(current) === keyOf(goalGrid)) {
      found = current;
      break;
    }

    open.delete(keyOf(current));
    const neighbors = [
      { col: current.col + 1, row: current.row },
      { col: current.col - 1, row: current.row },
      { col: current.col, row: current.row + 1 },
      { col: current.col, row: current.row - 1 },
    ];

    for (const neighbor of neighbors) {
      if (
        neighbor.col < 0 ||
        neighbor.row < 0 ||
        neighbor.col > maxCols ||
        neighbor.row > maxRows
      ) {
        continue;
      }

      const world = { x: neighbor.col * GRID, y: neighbor.row * GRID };
      if (isBlocked(world, room, furniture, mobility)) continue;
      const tentative = (gScore.get(keyOf(current)) ?? 0) + 1;
      if (
        tentative <
        (gScore.get(keyOf(neighbor)) ?? Number.POSITIVE_INFINITY)
      ) {
        cameFrom.set(keyOf(neighbor), current);
        gScore.set(keyOf(neighbor), tentative);
        fScore.set(
          keyOf(neighbor),
          tentative + distance(neighbor, goalGrid),
        );
        open.set(keyOf(neighbor), neighbor);
      }
    }
  }

  if (!found) {
    return {
      targetId: target.id,
      targetLabel: target.label,
      status: "blocked",
      points: [start, goal],
      distance: 0,
      minimumClearance: 0,
      turningSpot: null,
      approachZoneClear,
      approachClearance: target.clearanceDepth,
      purpose: target.purpose,
      message: `No route preserves the preferred ${mobility.minimumPassage} cm passage.`,
    };
  }

  const gridPath = [found];
  let cursor = found;
  while (cameFrom.has(keyOf(cursor))) {
    cursor = cameFrom.get(keyOf(cursor))!;
    gridPath.push(cursor);
  }
  gridPath.reverse();

  const path = simplifyPath(
    gridPath.map((point) => ({
      x: point.col * GRID,
      y: point.row * GRID,
    })),
  );
  const routeDistance = Math.max(0, (gridPath.length - 1) * GRID);
  const turningSpot = findTurningSpot(
    gridPath,
    room,
    furniture,
    mobility,
  );

  return {
    targetId: target.id,
    targetLabel: target.label,
    status: "clear",
    points: path,
    distance: routeDistance,
    minimumClearance: estimateMinimumClearance(
      path,
      room,
      furniture,
      target.objectId,
    ),
    turningSpot,
    approachZoneClear,
    approachClearance: target.clearanceDepth,
    purpose: target.purpose,
    message: `A ${Math.round(routeDistance / 10) / 10} m route reaches a clear ${target.purpose} zone.`,
  };
}

export function measureLayout(
  room: Room,
  furniture: FurnitureItem[],
  mobility: MobilityProfile,
  targets: RouteTarget[],
): LayoutMetrics {
  const routes = targets.map((target) =>
    simulateRoute(room, furniture, mobility, target),
  );
  const requiredIds = new Set(
    targets.filter((target) => target.required).map((target) => target.id),
  );
  const requiredRoutes = routes.filter((route) =>
    requiredIds.has(route.targetId),
  );

  return {
    reachable: routes.filter((route) => route.status === "clear").length,
    total: routes.length,
    requiredReachable: requiredRoutes.filter(
      (route) => route.status === "clear",
    ).length,
    requiredTotal: requiredRoutes.length,
    totalDistance: routes.reduce((sum, route) => sum + route.distance, 0),
    routesWithTurningSpace: routes.filter((route) => route.turningSpot).length,
    routes,
  };
}

export function findCriticalBarriers(
  room: Room,
  furniture: FurnitureItem[],
  mobility: MobilityProfile,
  targets: RouteTarget[],
) {
  const current = measureLayout(room, furniture, mobility, targets);
  if (current.requiredReachable === current.requiredTotal) return [];

  return furniture
    .filter((item) => !item.locked && !item.stabilityCritical)
    .map((item) => {
      const withoutItem = furniture.filter(
        (candidate) => candidate.id !== item.id,
      );
      const metrics = measureLayout(room, withoutItem, mobility, targets);
      return {
        id: item.id,
        name: item.name,
        reachableGain: metrics.requiredReachable - current.requiredReachable,
        resultingReachable: metrics.requiredReachable,
        requiredTotal: metrics.requiredTotal,
      };
    })
    .filter((item) => item.reachableGain > 0)
    .sort((a, b) => b.reachableGain - a.reachableGain);
}

export function applyProposalMoves(
  room: Room,
  furniture: FurnitureItem[],
  moves: ProposalMove[],
) {
  const errors: string[] = [];
  const moveMap = new Map(moves.map((move) => [move.objectId, move]));

  for (const move of moves) {
    const item = furniture.find((candidate) => candidate.id === move.objectId);
    if (!item) {
      errors.push(`Unknown object: ${move.objectId}`);
      continue;
    }
    if (item.locked || item.stabilityCritical) {
      errors.push(
        `${item.name} is protected because: ${
          item.lockReason ??
          (item.stabilityCritical
            ? "stability is critical during transfers"
            : "user preference")
        }`,
      );
    }
    if (![move.x, move.y].every(Number.isFinite)) {
      errors.push(`${item.name} has invalid coordinates.`);
    }
  }

  const proposed = furniture.map((item) => {
    const move = moveMap.get(item.id);
    if (!move) return { ...item };
    return clampFurniture(
      {
        ...item,
        x: move.x,
        y: move.y,
        rotation: move.rotation,
      },
      room,
    );
  });

  for (let first = 0; first < proposed.length; first += 1) {
    for (let second = first + 1; second < proposed.length; second += 1) {
      if (objectsOverlap(proposed[first], proposed[second])) {
        errors.push(
          `${proposed[first].name} overlaps ${proposed[second].name}.`,
        );
      }
    }
  }

  return { furniture: proposed, errors: [...new Set(errors)] };
}
