export type FilePickerOpts = {
  accept?: string;
};

export type PickedFile =
  | { kind: "web"; file: File }
  | { kind: "native"; uri: string; name: string };

export function useFilePicker() {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return (opts: FilePickerOpts = {}): Promise<PickedFile | null> => {
    throw new Error("useFilePicker is not implemented on this platform");
  };
}
