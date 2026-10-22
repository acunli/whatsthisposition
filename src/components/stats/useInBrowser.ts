import { useSyncExternalStore } from "react";

const never = () => () => {};

/** False while rendering on the server (and hydrating), true in the browser: for what only the browser knows, like its time zone. */
export const useInBrowser = () =>
  useSyncExternalStore(
    never,
    () => true,
    () => false,
  );
