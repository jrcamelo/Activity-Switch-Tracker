export type Arrow = '→' | '↝' | '↻';

export type Entry = {
  id: string;
  time: string | null;
  arrow: Arrow;
  text: string;
};
