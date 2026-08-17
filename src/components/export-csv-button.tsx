"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Takes fully pre-computed, plain data only (strings/numbers) — no
 * value-extractor functions. This is a Client Component, and functions
 * can't be passed as props from a Server Component across that boundary
 * (React throws "Functions cannot be passed directly to Client Components").
 * Do the row -> cell-values mapping in the Server Component that renders
 * this, then hand over the finished 2D array.
 */
export function ExportCsvButton({
  filename,
  headers,
  rows,
}: {
  filename: string;
  headers: string[];
  rows: (string | number)[][];
}) {
  function download() {
    const escape = (v: string | number) => {
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      headers.map(escape).join(","),
      ...rows.map((row) => row.map(escape).join(",")),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={download}
      disabled={rows.length === 0}
      className="gap-1.5"
    >
      <Download className="size-3.5" />
      Export CSV
    </Button>
  );
}