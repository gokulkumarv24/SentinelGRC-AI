"use client";

import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import type { FieldValues, Path, UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import { ApiError, errorMessage } from "@/lib/api";

/**
 * Mutation with consistent success feedback, cache invalidation and error handling.
 * When a form is passed, 422 field errors from the API are shown next to the matching inputs.
 */
export function useApiMutation<TVars, TResult>(options: {
  mutationFn: (vars: TVars) => Promise<TResult>;
  success?: string | ((result: TResult) => string);
  invalidate?: QueryKey[];
  form?: UseFormReturn<FieldValues>;
  onSuccess?: (result: TResult, vars: TVars) => void;
}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: options.mutationFn,
    onSuccess: async (result, vars) => {
      await Promise.all((options.invalidate ?? []).map((key) => qc.invalidateQueries({ queryKey: key })));
      if (options.success) toast.success(typeof options.success === "function" ? options.success(result) : options.success);
      options.onSuccess?.(result, vars);
    },
    onError: (error) => {
      if (options.form && error instanceof ApiError && error.status === 422) {
        for (const [path, message] of Object.entries(error.fieldErrors)) options.form.setError(path as Path<FieldValues>, { message });
      }
      if (error instanceof ApiError && error.code === "version_conflict") {
        toast.error("Someone else changed this record. The latest version has been loaded.");
        (options.invalidate ?? []).forEach((key) => qc.invalidateQueries({ queryKey: key }));
        return;
      }
      toast.error(errorMessage(error));
    },
  });
}
