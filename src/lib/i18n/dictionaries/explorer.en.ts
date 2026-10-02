import type { Dict } from './ko';

// P11-13 file job/queue/conflict/info/clipboard/search strings.
export const explorerEn: Dict = {
  'jobs.title': 'Background tasks',
  'jobs.empty': 'No running tasks.',
  'jobs.cancel': 'Cancel',
  'jobs.dismiss': 'Dismiss',
  'jobs.clearFinished': 'Clear finished',
  'jobs.running': 'Running',
  'jobs.done': 'Done',
  'jobs.failed': 'Failed',
  'jobs.cancelled': 'Cancelled',
  'jobs.filesProgress': '{done} / {total} files',
  'jobs.bytesProgress': '{done} / {total}',
  'jobs.matches': '{n} found',

  'conflict.title': 'An item with the same name exists',
  'conflict.desc': "'{name}' already exists. What should I do?",
  'conflict.overwrite': 'Overwrite',
  'conflict.skip': 'Skip',
  'conflict.rename': 'Rename',
  'conflict.renameTo': 'New name: {name}',
  'conflict.applyToAll': 'Apply to all',

  'props.title': 'Properties',
  'props.loading': 'Calculating...',
  'props.files': '{n} files',
  'props.dirs': '{n} folders',
  'props.size': 'Total size {size}',
  'props.failed': 'Failed to calculate: {err}',

  'clipboard.copyPending': '{n} pending copy',
  'clipboard.cutPending': '{n} pending cut',

  'search.results': '{n} results',
  'search.noResults': 'No results.',
  'search.searching': 'Searching...',
  'search.openFile': 'Open file',
  'search.cancelSearch': 'Stop search',
};
