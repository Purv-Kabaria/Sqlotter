// Reddit "thing id" guards for ids that round-trip through Redis as plain
// strings. The Devvit client types comment/post ids as the template-literal
// types `t1_${string}` / `t3_${string}` (@devvit/shared-types' T1/T3, which
// these are structurally identical to), so a stored id needs narrowing before
// it can be handed back to reddit.* calls — these guards do that without a
// cast, and double as corruption checks on whatever was in Redis.

export type CommentId = `t1_${string}`;
export type PostId = `t3_${string}`;

export function isCommentId(id: string): id is CommentId {
  return id.startsWith('t1_');
}

export function isPostId(id: string): id is PostId {
  return id.startsWith('t3_');
}
