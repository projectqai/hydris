export default null as unknown as {
  requestRequiredPermissions(): Promise<boolean>;
  startEngineService(): Promise<string>;
  stopEngine(): Promise<string>;
  isRunning(): Promise<boolean>;
};
