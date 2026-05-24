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

export type FeedbackDialogProps = {
  message: UIMessage | null;
  onOpenChange: (open: boolean) => void;
};

export function FeedbackDialog({ message, onOpenChange }: FeedbackDialogProps) {
  const [expected, setExpected] = useState("");
  const [justification, setJustification] = useState("");

  useEffect(() => {
    if (message) {
      setExpected("");
      setJustification("");
    }
  }, [message]);

  return (
    <Dialog open={message !== null} onOpenChange={onOpenChange}>
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
              onChange={(e) => setExpected(e.target.value)}
              placeholder="Describe the response you were hoping for…"
              rows={4}
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
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Help Pal understand the reasoning so it can apply this lesson elsewhere…"
              rows={4}
            />
          </section>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            type="button"
            disabled={!expected.trim() && !justification.trim()}
          >
            Submit feedback
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
