// SPDX-License-Identifier: BSD-3-Clause
// The parser lives in core so the terminal, MCP and CLI read input identically.
export {commandNumber as terminalNumber,parseCommandPoint as parseTerminalPoint,commandTokens as terminalTokens,commandArguments as terminalArguments} from '@brickwright/cad-core';
export type {CommandToken as TerminalArgument} from '@brickwright/cad-core';
