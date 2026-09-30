import { notFound } from "next/navigation";
import { USING_FIXTURES } from "@/lib/iris/client";

// Fixture stand-in for B's authenticated owner gateway, so evidence and receipt links resolve locally.
export default async function GatewayPlaceholder({ params }: PageProps<"/gateway/[...path]">) {
  if (!USING_FIXTURES) notFound();
  const { path } = await params;
  return (
    <main className="mx-auto flex max-w-xl flex-1 flex-col justify-center gap-3 px-4 py-16">
      <p className="w-fit rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">Fixture data</p>
      <h1 className="font-mono text-lg">/gateway/{path.join("/")}</h1>
      <p className="text-muted">
        This page stands in for the owner gateway, which will serve issue, evidence and comment pages once the backend is
        connected.
      </p>
    </main>
  );
}
