import {
  createQwikCity,
  type PlatformCloudflarePages,
} from "@builder.io/qwik-city/middleware/cloudflare-pages";
import qwikCityPlan from "@qwik-city-plan";
import render from "./entry.ssr";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface QwikCityPlatform extends PlatformCloudflarePages {}
}

const fetch = createQwikCity({ render, qwikCityPlan });

export { fetch };
