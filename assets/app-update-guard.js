export function canApplyAppUpdate({ready, writerMode, blockedCount, saveFailed, session, historicalWorkspace, historicalMemory, route}) {
  return ready === true && writerMode !== 'memory' && blockedCount === 0 &&
    !saveFailed && !historicalMemory && (!session || !!session.finishedAt) &&
    !historicalWorkspace?.active &&
    !['mistakes', 'bank', 'paper', 'practice', 'pyq'].includes(route);
}
