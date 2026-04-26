// Generalized response type combined with ark
export type Response<T> = {
  ok: boolean;
  data?: T;
  error?: string;
  problemsByPath?: Record<string, string[]>;
};
