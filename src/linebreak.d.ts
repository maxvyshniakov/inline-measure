declare module "linebreak" {
  export interface LineBreak {
    position: number;
    required: boolean;
  }

  export default class LineBreaker {
    constructor(text: string);
    nextBreak(): LineBreak | null;
  }
}
