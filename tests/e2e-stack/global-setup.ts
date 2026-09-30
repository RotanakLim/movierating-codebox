import { reseed } from "./seed";

export default async function globalSetup() {
  await reseed();
}
