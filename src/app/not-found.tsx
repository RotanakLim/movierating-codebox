import Link from "next/link";
export default function NotFound() {
  return (
    <section className="py-20">
      <p className="eyebrow">404 · MISSING SCENE</p>
      <h1 className="my-5 font-display text-4xl">
        This page isn’t in the collection.
      </h1>
      <Link href="/" className="button-primary">
        Back home
      </Link>
    </section>
  );
}
