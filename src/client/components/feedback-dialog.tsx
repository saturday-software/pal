import { useEffect, useState } from "react";
import type { UIMessage } from "ai";
import {
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { SubmitFeedbackResult } from "../../shared";

export type FeedbackDialogProps = {
  message: UIMessage | null;
  traceId: string | undefined;
  onSubmit: (args: {
    messageId: string;
    traceId: string;
    expected: string;
    justification: string;
  }) => Promise<SubmitFeedbackResult>;
  onOpenChange: (open: boolean) => void;
};

export function FeedbackDialog({
  message,
  traceId,
  onSubmit,
  onOpenChange,
}: FeedbackDialogProps) {
  const [expected, setExpected] = useState("");
  const [justification, setJustification] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (message) {
      setExpected("");
      setJustification("");
      setSubmitting(false);
      setError(null);
    }
  }, [message]);

  const hasContent = expected.trim() !== "" || justification.trim() !== "";
  // Note: do NOT include `!error` here — Submit must stay enabled after
  // a failure so the user can retry without having to nudge a textarea.
  const canSubmit = !!message && !!traceId && hasContent && !submitting;

  const handleSubmit = async () => {
    if (!message || !traceId || !hasContent || submitting) return;
    setSubmitting(true);
    setError(null);
    const result = await onSubmit({
      messageId: message.id,
      traceId,
      expected: expected.trim(),
      justification: justification.trim(),
    });
    if (result.ok) {
      onOpenChange(false);
    } else {
      setError(result.error);
      setSubmitting(false);
    }
  };

  // Don't let ESC / backdrop click dismiss the dialog mid-submit — the
  // in-flight `onSubmit` would resolve onto an unmounted component and
  // a server-side failure would be silently dropped.
  const guardedOnOpenChange = (open: boolean) => {
    if (!open && submitting) return;
    onOpenChange(open);
  };

  const onExpectedChange = (v: string) => {
    setExpected(v);
    if (error) setError(null);
  };
  const onJustificationChange = (v: string) => {
    setJustification(v);
    if (error) setError(null);
  };

  return (
    <Dialog open={message !== null} onOpenChange={guardedOnOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Help Pal improve</DialogTitle>
          <DialogDescription>
            Tell Pal what went wrong with this response so it can do better
            next time.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Downvoted message</h3>
            <div className="max-h-64 overflow-y-auto rounded-md border bg-muted/40 p-3 text-sm">
              {message ? (
                <div className="flex flex-col gap-2">
                  {message.parts.map((p, i) => {
                    if (p.type === "text") {
                      return (
                        <MessageResponse key={i}>{p.text}</MessageResponse>
                      );
                    }
                    if (p.type === "reasoning") {
                      return (
                        <Reasoning key={i} defaultOpen>
                          <ReasoningTrigger />
                          <ReasoningContent>{p.text}</ReasoningContent>
                        </Reasoning>
                      );
                    }
                    return null;
                  })}
                </div>
              ) : null}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <label htmlFor="feedback-expected" className="text-sm font-medium">
              What did you expect to see?
            </label>
            <Textarea
              id="feedback-expected"
              value={expected}
              onChange={(e) => onExpectedChange(e.target.value)}
              placeholder="Describe the response you were hoping for…"
              rows={4}
              disabled={submitting}
            />
          </section>

          <section className="flex flex-col gap-2">
            <label
              htmlFor="feedback-justification"
              className="text-sm font-medium"
            >
              Why? (justification)
            </label>
            <Textarea
              id="feedback-justification"
              value={justification}
              onChange={(e) => onJustificationChange(e.target.value)}
              placeholder="Help Pal understand the reasoning so it can apply this lesson elsewhere…"
              rows={4}
              disabled={submitting}
            />
          </section>

          {message && !traceId ? (
            <p className="text-sm text-muted-foreground">
              This message doesn't have a trace ID — feedback isn't
              available. If you keep seeing this, refresh the page.
            </p>
          ) : null}

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={submitting}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {submitting ? "Submitting…" : "Submit feedback"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
