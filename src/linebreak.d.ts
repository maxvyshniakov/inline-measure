// UPSTREAM(linebreak > 2.0.0): 2.0.0 ships no types. devongovett/linebreaker added
// src/linebreaker.d.ts on main after it (2026-11-20, "added typescript types");
// drop this file once a release with them is out.
declare module "linebreak" {
  export interface LineBreak {
    position: number;
    required: boolean;
  }

  export class LineBreaker {
    constructor(text: string);
    nextBreak(): LineBreak | null;
  }
}
