"use client";

import Link from "next/link";

export default function AdminHeader(props: { title: string; backHref?: string; right?: React.ReactNode }) {
  return (
    <header className="mx-auto max-w-2xl p-4 pb-2 space-y-2">
      {props.backHref ? (
        <div className="text-sm">
          <Link className="underline opacity-80 hover:opacity-100" href={props.backHref}>
            ← Back
          </Link>
        </div>
      ) : null}

      <div className="flex items-start justify-between gap-3">
        <h1 className="text-xl font-semibold">{props.title}</h1>
        {props.right ? <div className="shrink-0">{props.right}</div> : null}
      </div>
    </header>
  );
}