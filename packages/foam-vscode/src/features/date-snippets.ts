import {
  ExtensionContext,
  languages,
  CompletionItemProvider,
  CompletionItem,
  CompletionItemKind,
  CompletionList,
  CompletionTriggerKind,
} from 'vscode';
import { getDailyNoteFileName } from '../dated-notes';
import { getLoamVsCodeConfig } from '../services/config';

export default async function activate(context: ExtensionContext) {
  context.subscriptions.push(
    languages.registerCompletionItemProvider('markdown', completions, '/'),
    languages.registerCompletionItemProvider(
      'markdown',
      datesCompletionProvider,
      '/'
    )
  );
}

interface DateSnippet {
  snippet: string;
  date: Date;
  detail: string;
}

const daysOfWeek = [
  { day: 'sunday', index: 0 },
  { day: 'monday', index: 1 },
  { day: 'tuesday', index: 2 },
  { day: 'wednesday', index: 3 },
  { day: 'thursday', index: 4 },
  { day: 'friday', index: 5 },
  { day: 'saturday', index: 6 },
];

const generateDayOfWeekSnippets = (): DateSnippet[] => {
  const getFutureTarget = (day: number) => {
    const target = new Date();
    const currentDay = target.getDay();
    const distance = (day + 7 - currentDay) % 7;
    target.setDate(target.getDate() + distance);
    return target;
  };
  // needs work
  const getPastTarget = (day: number) => {
    const target = new Date();
    const currentDay = target.getDay();
    const distance = currentDay === day ? 7 : (7 + currentDay - day) % 7;
    target.setDate(target.getDate() - distance);
    return target;
  };

  const snippets = daysOfWeek.map(({ day, index }) => {
    const target = getFutureTarget(index);
    return {
      date: target,
      detail: `Get a daily note link for ${day}`,
      snippet: `/${day}`,
    };
  });

  // append snippets previous days
  snippets.push(
    ...daysOfWeek.map(({ day, index }) => {
      const target = getPastTarget(index);
      return {
        date: target,
        detail: `Get a daily note link for last ${day}`,
        snippet: `/-${day}`,
      };
    })
  );
  return snippets;
};

const createCompletionItem = ({ snippet, date, detail }: DateSnippet) => {
  const completionItem = new CompletionItem(
    snippet,
    CompletionItemKind.Snippet
  );
  completionItem.insertText = getDailyNoteLink(date);
  completionItem.detail = `${completionItem.insertText} - ${detail}`;
  if (getLoamVsCodeConfig('dateSnippets.afterCompletion') !== 'noop') {
    completionItem.command = {
      command: 'loam-vscode.open-dated-note',
      title: 'Open a note for the given date',
      arguments: [date],
    };
  }
  return completionItem;
};

const getDailyNoteLink = (date: Date) => {
  const loamExtension = getLoamVsCodeConfig('openDailyNote.fileExtension');
  const name = getDailyNoteFileName(date);
  return `[[${name.replace(`.${loamExtension}`, '')}]]`;
};

const snippetFactories: (() => DateSnippet)[] = [
  () => ({
    detail: "Insert a link to today's daily note",
    snippet: '/day',
    date: new Date(),
  }),
  () => ({
    detail: "Insert a link to today's daily note",
    snippet: '/today',
    date: new Date(),
  }),
  () => {
    const today = new Date();
    return {
      detail: "Insert a link to tomorrow's daily note",
      snippet: '/tomorrow',
      date: new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate() + 1
      ),
    };
  },
  () => {
    const today = new Date();
    return {
      detail: "Insert a link to yesterday's daily note",
      snippet: '/yesterday',
      date: new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate() - 1
      ),
    };
  },
];

const computedSnippets: ((number: number) => DateSnippet)[] = [
  (days: number) => {
    const today = new Date();
    return {
      detail: `Insert a date ${days} day(s) from now`,
      snippet: `/+${days}d`,
      date: new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate() + days
      ),
    };
  },
  (weeks: number) => {
    const today = new Date();
    return {
      detail: `Insert a date ${weeks} week(s) from now`,
      snippet: `/+${weeks}w`,
      date: new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate() + 7 * weeks
      ),
    };
  },
  (months: number) => {
    const today = new Date();
    return {
      detail: `Insert a date ${months} month(s) from now`,
      snippet: `/+${months}m`,
      date: new Date(
        today.getFullYear(),
        today.getMonth() + months,
        today.getDate()
      ),
    };
  },
  (years: number) => {
    const today = new Date();
    return {
      detail: `Insert a date ${years} year(s) from now`,
      snippet: `/+${years}y`,
      date: new Date(
        today.getFullYear() + years,
        today.getMonth(),
        today.getDate()
      ),
    };
  },
];

const completions: CompletionItemProvider = {
  provideCompletionItems: (document, position, _token, _context) => {
    if (_context.triggerKind === CompletionTriggerKind.Invoke) {
      // if completion was triggered without trigger character then we return [] to fallback
      // to vscode word-based suggestions (see https://github.com/loambubble/loam/pull/417)
      return [];
    }
    const range = document.getWordRangeAtPosition(position, /\S+/);
    const completionItems = [
      ...snippetFactories.map(snippetFactory => snippetFactory()),
      ...generateDayOfWeekSnippets(),
    ].map(snippet => {
      const completionItem = createCompletionItem(snippet);
      completionItem.range = range;
      return completionItem;
    });
    return completionItems;
  },
};

export const datesCompletionProvider: CompletionItemProvider = {
  provideCompletionItems: (document, position, _token, context) => {
    if (context.triggerKind === CompletionTriggerKind.Invoke) {
      // if completion was triggered without trigger character then we return [] to fallback
      // to vscode word-based suggestions (see https://github.com/loambubble/loam/pull/417)
      return [];
    }

    const range = document.getWordRangeAtPosition(position, /\S+/);
    const snippetString = document.getText(range);
    const matches = snippetString.match(/(\d+)/);
    const number: string = matches ? matches[0] : '1';
    const completionItems = computedSnippets.map(item => {
      const completionItem = createCompletionItem(item(parseInt(number)));
      completionItem.range = range;
      return completionItem;
    });
    // We still want the list to be treated as "incomplete", because the user may add another number
    return new CompletionList(completionItems, true);
  },
};
