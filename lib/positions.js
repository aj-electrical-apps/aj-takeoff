// Positions and what each one can do (Jonathan 2026-10-30: "a full admin page so I can pick what access each position has").
// The Admin page edits the list; it's saved with the people in team/admin/users-*.json. Admin always has everything.
export const PERMS = [
  ["edit", "Change the estimate", "Counts, runs, office mark-ups, sheets, new jobs"],
  ["cost", "Prices, bid sheet and proposal", "Total cost and every dollar amount"],
  ["hours", "Man hours by category", "Hours allotted to each part of the job, no dollars"],
  ["tracker", "Bid tracker", ""],
  ["lists", "Parts lists and labor rates", "Changes wait for an admin's OK"],
  ["counts", "Count sheet, supplier sheet and underground", ""],
  ["order", "Order page", "Material order from the drawings"],
  ["marks", "Their own mark-ups", "Office mark-ups show faded, and they can hide them"],
  ["scale", "Measure and set the scale", "Their scale is used only where the office hasn't set one"],
  ["notesdel", "Delete sent messages", "Remove a Highlight & send message after it's sent (like the COO and CEO)"],
  ["pins", "Turn location pins green", "Mark a pin done once it's laid out in the field (the mark-up crew)"],
  ["subs", "Add subcontractors", "Give a sub a password and pick which jobs they see"],
  ["precon", "Precon counts", "Every tool, but what they add goes in their own precon layer, never the estimate. They can take estimate counts off the Order page"],
];
export const ALL = PERMS.map(p => p[0]);
export const DEFAULT_POSITIONS = [
  { key: "admin", name: "Admin", perms: ALL },
  { key: "estimator", name: "Estimator", perms: ALL },
  { key: "pm", name: "Project manager", perms: ["cost", "hours", "tracker", "lists", "counts", "order", "marks", "scale", "subs"] },
  { key: "super", name: "Superintendent", perms: ["hours", "counts", "order", "marks", "scale"] },
  { key: "foreman", name: "Foreman", perms: ["marks", "scale"] },
  // subs see only the jobs a PM shares with them (Jonathan 2026-10-30)
  { key: "sub", name: "Subcontractor", perms: ["marks"] },
  // Jonathan 2026-11-04: precon sees everything and uses every tool, but only changes its own counts (no "edit")
  { key: "precon", name: "Precon", perms: ALL.filter(p => p !== "edit") },
];
export const SUB = "sub";
const LEGACY = { office: "estimator", field: "super" };
export const roleKey = r => LEGACY[r] || r;
export function positionsOf(saved) {
  const list = Array.isArray(saved) && saved.length ? saved.map(p => ({ key: String(p.key), name: String(p.name || p.key), perms: (p.perms || []).filter(x => ALL.includes(x)) })) : DEFAULT_POSITIONS.map(p => ({ ...p, perms: [...p.perms] }));
  const admin = list.find(p => p.key === "admin");
  if (admin) admin.perms = [...ALL]; else list.unshift({ key: "admin", name: "Admin", perms: [...ALL] });
  if (!list.some(p => p.key === "precon")) list.push({ ...DEFAULT_POSITIONS.find(p => p.key === "precon"), perms: ALL.filter(p => p !== "edit") }); // added 2026-11-04
  if (!list.some(p => p.key === SUB)) list.push({ ...DEFAULT_POSITIONS.find(p => p.key === SUB), perms: ["marks"] }); // the PM's sub sign-ins need it
  return list;
}
// what a role can do: admin gets "admin" too
export function permsFor(positions, role) {
  const k = roleKey(role);
  if (k === "admin") return [...ALL, "admin"];
  const p = positionsOf(positions).find(x => x.key === k);
  return p ? [...p.perms] : [];
}
