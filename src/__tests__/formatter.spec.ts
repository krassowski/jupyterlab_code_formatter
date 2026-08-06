import { INotebookTracker } from '@jupyterlab/notebook';
import JupyterlabCodeFormatterClient from '../client';
import { JupyterlabNotebookCodeFormatter } from '../formatter';
import { IConfig } from '../tokens';
import settingsSchema from '../../schema/settings.json';

/**
 * Expose the protected formatter resolution for testing.
 */
class TestFormatter extends JupyterlabNotebookCodeFormatter {
  public resolve(
    config: IConfig,
    language: string | null | undefined,
    formatter?: string
  ) {
    return this.getFormattersToUse(config, language, formatter);
  }
}

function makeConfig(default_formatter: {
  [language: string]: string | string[];
}): IConfig {
  return { preferences: { default_formatter } } as IConfig;
}

describe('JupyterlabCodeFormatter', () => {
  let formatter: TestFormatter;

  beforeEach(() => {
    formatter = new TestFormatter(
      null as unknown as JupyterlabCodeFormatterClient,
      null as unknown as INotebookTracker
    );
  });

  describe('#getFormattersToUse()', () => {
    it('should find the formatter for an exactly matching language', () => {
      const config = makeConfig({ python: ['isort', 'black'] });
      expect(formatter.resolve(config, 'python')).toEqual(['isort', 'black']);
    });

    it('should find the formatter regardless of the language case', () => {
      // Kernels are inconsistent about the case of the language they report,
      // e.g. IRkernel reports `R` while the notebook metadata says `r`.
      const config = makeConfig({ r: 'formatR' });
      expect(formatter.resolve(config, 'R')).toEqual(['formatR']);
      expect(formatter.resolve(config, 'r')).toEqual(['formatR']);

      const legacyConfig = makeConfig({ R: 'styler' });
      expect(formatter.resolve(legacyConfig, 'r')).toEqual(['styler']);
      expect(formatter.resolve(legacyConfig, 'R')).toEqual(['styler']);
    });

    it('should prefer an exact match over a case-insensitive one', () => {
      const config = makeConfig({ r: 'formatR', R: 'styler' });
      expect(formatter.resolve(config, 'R')).toEqual(['styler']);
      expect(formatter.resolve(config, 'r')).toEqual(['formatR']);
    });

    it('should raise if there is no formatter for the language', () => {
      const config = makeConfig({ python: 'black' });
      expect(() => formatter.resolve(config, 'julia')).toThrow(
        'Unable to find default formatters to use'
      );
    });

    it('should ignore the properties inherited from the prototype', () => {
      const config = makeConfig({ python: 'black' });
      expect(() => formatter.resolve(config, 'constructor')).toThrow(
        'Unable to find default formatters to use'
      );
    });

    it('should raise if the language is unknown', () => {
      const config = makeConfig({ python: 'black' });
      expect(() => formatter.resolve(config, null)).toThrow(
        'Unable to find default formatters to use'
      );
    });

    it('should use the explicitly requested formatter', () => {
      const config = makeConfig({ python: 'black' });
      expect(formatter.resolve(config, 'python')).toEqual(['black']);
      expect(formatter.resolve(config, 'python', 'yapf')).toEqual(['yapf']);
    });

    it('should filter out the no-op pseudo-formatters', () => {
      const config = makeConfig({ python: ['isort', 'noop', 'skip'] });
      expect(formatter.resolve(config, 'python')).toEqual(['isort']);
    });

    it('should resolve the languages of the shipped defaults', () => {
      // The languages are reported by the kernels in lower case.
      const config = makeConfig(
        settingsSchema.properties.preferences.default.default_formatter
      );
      expect(formatter.resolve(config, 'python')).toEqual(['isort', 'black']);
      expect(formatter.resolve(config, 'r')).toEqual(['formatR']);
      expect(formatter.resolve(config, 'rust')).toEqual(['rustfmt']);
      expect(formatter.resolve(config, 'c++11')).toEqual(['astyle']);
    });
  });
});
