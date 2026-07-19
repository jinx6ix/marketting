"use client";

import { useRef, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  addKeyword,
  deleteKeyword,
  toggleKeyword,
} from "@/features/inbox/actions";
import type { TrackedKeyword } from "@/types/database";

const KINDS = [
  { value: "keyword", label: "Keyword" },
  { value: "hashtag", label: "Hashtag" },
  { value: "destination", label: "Destination" },
  { value: "brand", label: "Brand" },
];

export function KeywordsPanel({ keywords }: { keywords: TrackedKeyword[] }) {
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const kindRef = useRef<HTMLSelectElement>(null);

  const submit = () => {
    const keyword = inputRef.current?.value.trim();
    const kind = kindRef.current?.value ?? "keyword";
    if (!keyword) return;
    startTransition(async () => {
      const result = await addKeyword({ keyword, kind });
      if (!result.error && inputRef.current) inputRef.current.value = "";
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          ref={inputRef}
          placeholder="bali, #islandhopping, …"
          className="flex-1"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />
        <Select ref={kindRef} className="w-32" defaultValue="keyword">
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </Select>
        <Button size="icon" onClick={submit} disabled={pending} title="Add keyword">
          <Plus />
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {keywords.map((k) => (
          <span key={k.id} className="group flex items-center gap-1">
            <button
              type="button"
              disabled={pending}
              title={k.active ? "Click to pause" : "Click to activate"}
              onClick={() =>
                startTransition(() => toggleKeyword(k.id, !k.active).then(() => {}))
              }
            >
              <Badge variant={k.active ? "default" : "outline"}>
                {k.kind === "hashtag" ? "#" : ""}
                {k.keyword}
                <span className="ml-1.5 text-[10px] opacity-70">{k.kind}</span>
              </Badge>
            </button>
            <button
              type="button"
              className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              disabled={pending}
              title="Delete keyword"
              onClick={() =>
                startTransition(() => deleteKeyword(k.id).then(() => {}))
              }
            >
              <Trash2 className="size-3.5" />
            </button>
          </span>
        ))}
        {keywords.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No tracked keywords — add destinations, hashtags, or your brand name
            to monitor them across platforms.
          </p>
        )}
      </div>
    </div>
  );
}
