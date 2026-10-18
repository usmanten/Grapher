/** One connection Claude is asked to explain. Built only from the scrubbed graph. */
export interface ExplainTask {
  id: string;
  fingerprint: string;
  from: { name: string; is: string };
  to: { name: string; is: string };
  label: string;
  details?: string[];
  code: { path: string; line: number; code: string }[];
}

export interface CachedExplanation {
  fingerprint: string;
  text: string;
}

/** `.grapher/explanations.json`: explanations kept between runs. */
export interface ExplanationCache {
  version: 1;
  entries: Record<string, CachedExplanation>;
}
