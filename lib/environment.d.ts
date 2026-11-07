/**
 * Host operating environment and platform detection.
 * @module dsh-zotero/environment
 */
/**
 * Determine whether the current process is running inside Windows Subsystem for Linux (WSL).
 * Checks explicit distribution/interop variables.
 */
export declare function isWsl(env?: NodeJS.ProcessEnv): boolean;
/**
 * Append or format a variable into WSLENV for Linux-to-Windows interop forwarding.
 * If varName is already in WSLENV, returns the existing WSLENV string untouched.
 */
export declare function appendWslEnv(env: NodeJS.ProcessEnv, varName: string): string;
//# sourceMappingURL=environment.d.ts.map