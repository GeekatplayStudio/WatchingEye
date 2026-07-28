/** Shared layout primitives for the documentation pages. */
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";

/** Page frame: back link, title, and lede. */
export function DocShell({
  title,
  lede,
  children,
}: {
  title: string;
  lede: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href="/docs"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Documentation
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-muted-foreground">{lede}</p>
      </div>
      {children}
    </div>
  );
}

/** A titled block of prose. */
export function DocSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm leading-relaxed text-muted-foreground">
        {children}
      </CardContent>
    </Card>
  );
}

/** One numbered pipeline stage, with the file that implements it. */
export function Stage({
  n,
  name,
  file,
  rejects,
  children,
}: {
  n: number;
  name: string;
  file: string;
  rejects: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-l-2 border-border pl-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">
          {n}
        </span>
        <span className="font-medium text-foreground">{name}</span>
        <Badge variant="outline">{file}</Badge>
      </div>
      <p className="mt-1">{children}</p>
      <p className="mt-1 text-xs">
        <span className="text-danger">Rejects:</span> {rejects}
      </p>
    </div>
  );
}

/** A guardrail gate: what it checks and what it stops. */
export function Gate({
  n,
  name,
  catches,
  children,
}: {
  n: number;
  name: string;
  catches: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">gate {n}</Badge>
        <span className="font-medium text-foreground">{name}</span>
      </div>
      <p className="mt-1">{children}</p>
      <p className="mt-1 text-xs">
        <span className="text-primary">Stops:</span> {catches}
      </p>
    </div>
  );
}
