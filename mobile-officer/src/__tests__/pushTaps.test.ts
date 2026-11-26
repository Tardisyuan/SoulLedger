/**
 * A tapped push lands once (the soul app's a09551f7a, now `listenForTaps` in pushCore.ts): some platforms hand the
 * tap that cold-started the app to the listener as well, and the Shell -- with this listener -- mounts again on each
 * sign-in. Mutation: drop the identifier check in `listenForTaps` -> the first test lands twice.
 */
import * as Notifications from "expo-notifications";

import { listenForLandings } from "../push";

type Response = { notification: { request: { identifier: string; content: { data: unknown } } } };
const system = (Notifications as unknown as { __state: { lastResponse: Response | null; responseListeners: Set<(r: Response) => void> } }).__state;
const response = (identifier: string): Response => ({ notification: { request: { identifier, content: { data: { category: "officer_todo" } } } } });
const tapListeners = (r: Response) => {
  for (const listener of system.responseListeners) listener(r);
};

afterEach(() => {
  system.lastResponse = null;
});

it("the tap that cold-started the app lands once, though the listener is handed it too", async () => {
  system.lastResponse = response("cold-1");
  const onLand = jest.fn();
  const stop = listenForLandings(onLand);
  await Promise.resolve();
  await Promise.resolve();
  expect(onLand).toHaveBeenCalledTimes(1);
  expect(system.lastResponse).toBeNull();
  tapListeners(response("cold-1"));
  expect(onLand).toHaveBeenCalledTimes(1);
  stop();
});
