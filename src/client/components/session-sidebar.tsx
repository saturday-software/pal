import { GitBranchIcon, MoreHorizontalIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { SessionInfo } from "../../shared";

export type SessionSidebarProps = {
  sessions: SessionInfo[];
  activeId: string;
  onCreate: () => void;
  onSwitch: (id: string) => void;
  onRename: (id: string, currentName: string) => void;
  onDelete: (id: string, name: string) => void;
};

export function SessionSidebar({
  sessions,
  activeId,
  onCreate,
  onSwitch,
  onRename,
  onDelete,
}: SessionSidebarProps) {
  return (
    <aside className="flex w-64 shrink-0 flex-col gap-2 rounded-xl border bg-card p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight">Sessions</h2>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onCreate}
          aria-label="New session"
          title="New session"
        >
          <PlusIcon className="size-4" />
        </Button>
      </div>
      <div className="flex flex-1 flex-col gap-1 overflow-y-auto">
        {sessions.length === 0 ? (
          <p className="px-2 py-1 text-xs text-muted-foreground">
            No sessions yet.
          </p>
        ) : (
          sessions.map((s) => (
            <div
              key={s.id}
              className={cn(
                "group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm",
                s.id === activeId
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-secondary/60",
              )}
            >
              <button
                type="button"
                onClick={() => onSwitch(s.id)}
                className="flex-1 truncate text-left"
                title={s.name}
              >
                {s.name}
                {s.parent_session_id ? (
                  <GitBranchIcon className="ml-1 inline size-3 align-text-bottom opacity-60" />
                ) : null}
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
                    aria-label="Session actions"
                  >
                    <MoreHorizontalIcon className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => onRename(s.id, s.name)}>
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => onDelete(s.id, s.name)}
                  >
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
