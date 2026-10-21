"use client";

import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { api } from "@/lib/api";

interface Rule {
  key: string;
  version: string;
  name: string;
  description: string;
  parameters: string[];
}

/** Attach or update an automated rule on a control. Parameters are validated by the API against the rule's schema. */
export function RuleConfigDialog({ controlId, trigger, initial }: { controlId: string; trigger: ReactNode; initial?: { ruleKey: string; parameters: Record<string, unknown>; frequencyHours: number; enabled: boolean } }) {
  const [open, setOpen] = useState(false);
  const [ruleKey, setRuleKey] = useState(initial?.ruleKey ?? "evidence_currency");
  const [params, setParams] = useState(JSON.stringify(initial?.parameters ?? {}, null, 2));
  const [frequency, setFrequency] = useState(initial?.frequencyHours ?? 24);
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const rules = useQuery({ queryKey: ["control-tests", "rules"], queryFn: () => api.get<Rule[]>("/control-tests/rules"), enabled: open });
  const save = useApiMutation({
    mutationFn: (parameters: Record<string, unknown>) => api.put(`/controls/${controlId}/test-configs`, { ruleKey, parameters, frequencyHours: frequency, enabled }),
    success: "Rule configuration saved",
    invalidate: [["controls"]],
    onSuccess: () => setOpen(false),
  });
  const rule = rules.data?.find((r) => r.key === ruleKey);
  const submit = () => {
    try {
      const parsed = JSON.parse(params || "{}");
      if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) throw new Error();
      setJsonError(null);
      save.mutate(parsed);
    } catch {
      setJsonError("Parameters must be a JSON object.");
    }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Automated test rule</DialogTitle>
          <DialogDescription>The scheduler runs enabled rules on their frequency. Results are recorded with the rule version.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="rule">Rule</Label>
            <Select value={ruleKey} onValueChange={setRuleKey} disabled={!!initial}>
              <SelectTrigger id="rule" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {rules.data?.map((r) => (
                  <SelectItem key={r.key} value={r.key}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {rule && <p className="text-xs text-muted-foreground">{rule.description}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="params">Parameters (JSON)</Label>
            <Textarea id="params" rows={4} className="font-mono text-xs" value={params} onChange={(e) => setParams(e.target.value)} />
            {rule?.parameters.length ? <p className="text-xs text-muted-foreground">Available: {rule.parameters.join(", ")}</p> : null}
            {jsonError && <p className="text-xs text-destructive">{jsonError}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="freq">Run every (hours)</Label>
              <Input id="freq" type="number" min={1} max={2160} value={frequency} onChange={(e) => setFrequency(Number(e.target.value))} />
            </div>
            <div className="flex items-end gap-2 pb-1">
              <Switch id="enabled" checked={enabled} onCheckedChange={setEnabled} />
              <Label htmlFor="enabled">Enabled</Label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
