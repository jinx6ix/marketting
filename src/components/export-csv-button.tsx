"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ExportCsvButtonProps<T extends Record<string, unknown>> {
  filename: string;
  data: T[];
  columns: (keyof T)[];
  columnLabels?: Partial<Record<keyof T, string>>;
}

/** Small "Export CSV" button — builds the file client-side, no server round trip. */
export function ExportCsvButton<T extends Record<string, unknown>>({
  filename,
  data,
  columns,
  columnLabels,
}: ExportCsvButtonProps<T>) {
  function download() {
    const escape = (v: unknown) => {
      const s = String(v !== undefined && v !== null ? v : "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const headers = columns.map((col) =>
      escape(columnLabels?.[col] ?? String(col))
    );

    const lines = [
      headers.join(","),
      ...data.map((row) =>
        columns.map((col) => escape(row[col])).join(",")
      ),
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
      disabled={data.length === 0}
      className="gap-1.5"
    >
      <Download className="size-3.5" />
      Export CSV
    </Button>
  );
}