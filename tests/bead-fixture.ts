import { type Bead, beadSchema } from "../lib/schema";

export function makeBead(id: string, fields: Partial<Bead> = {}): Bead {
  return beadSchema.parse({ id, title: id, status: "open", issue_type: "task", ...fields });
}

export function required<T>(value: T | undefined | null): T {
  if (value == null) throw new Error("Expected fixture value to exist");
  return value;
}
