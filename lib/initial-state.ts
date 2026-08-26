import { buildWorkspace } from "./scenarios";

export const initialState = buildWorkspace(
  "bedroom",
  new Date("2026-08-26T09:00:00.000Z").toISOString(),
);
