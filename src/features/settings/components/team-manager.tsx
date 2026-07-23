"use client";

import { useState, useTransition } from "react";
import { UserPlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  inviteMember,
  removeMember,
  updateMemberRole,
} from "@/features/settings/actions";

export function InviteForm() {
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("editor");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="teammate@example.com"
          className="flex-1"
        />
        <Select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="w-28"
        >
          <option value="admin">Admin</option>
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
        </Select>
        <Button
          disabled={pending || !email.trim()}
          onClick={() => {
            setError(null);
            setMessage(null);
            startTransition(async () => {
              const result = await inviteMember({ email: email.trim(), role });
              if (result.error) setError(result.error);
              else {
                setMessage(result.message ?? "Done.");
                setEmail("");
              }
            });
          }}
        >
          <UserPlus /> {pending ? "Inviting…" : "Invite"}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {message && <p className="text-sm text-success">{message}</p>}
    </div>
  );
}

export function MemberRoleControls({
  userId,
  role,
  isSelf,
  canManage,
  callerIsOwner,
}: {
  userId: string;
  role: string;
  isSelf: boolean;
  canManage: boolean;
  callerIsOwner: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!canManage || isSelf) {
    return <span className="text-sm capitalize text-muted-foreground">{role}</span>;
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {error && <span className="text-xs text-destructive">{error}</span>}
      <Select
        value={role}
        disabled={pending}
        className="w-28"
        onChange={(e) => {
          setError(null);
          startTransition(async () => {
            const result = await updateMemberRole(userId, e.target.value);
            if (result.error) setError(result.error);
          });
        }}
      >
        {callerIsOwner && <option value="owner">Owner</option>}
        {!callerIsOwner && role === "owner" && (
          <option value="owner">Owner</option>
        )}
        <option value="admin">Admin</option>
        <option value="editor">Editor</option>
        <option value="viewer">Viewer</option>
      </Select>
      <Button
        variant="ghost"
        size="icon"
        disabled={pending}
        title="Remove from organization"
        className="text-destructive hover:text-destructive"
        onClick={() => {
          if (!confirm("Remove this member from the organization?")) return;
          setError(null);
          startTransition(async () => {
            const result = await removeMember(userId);
            if (result.error) setError(result.error);
          });
        }}
      >
        <Trash2 />
      </Button>
    </div>
  );
}
