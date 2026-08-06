import {
  expect,
  galata,
  IJupyterLabPageFixture,
  test
} from '@jupyterlab/galata';

/**
 * The kernel specifications of the notebooks used in the tests.
 */
const KERNELSPECS = {
  python: { display_name: 'Python 3', language: 'python', name: 'python3' },
  // The language reported by IRkernel is capitalised, unlike the language of
  // most other kernels; see https://github.com/jupyterlab-contrib/jupyterlab_code_formatter/issues/327
  R: { display_name: 'R', language: 'R', name: 'ir' }
};

/**
 * Create a notebook with the given cells and open it.
 */
const openNotebook = async (
  page: IJupyterLabPageFixture,
  path: string,
  cells: (string | { markdown: string })[],
  kernelspec = KERNELSPECS.python
) => {
  const content = {
    cells: cells.map(cell =>
      typeof cell === 'string'
        ? {
            cell_type: 'code',
            execution_count: null,
            metadata: {},
            outputs: [],
            source: cell
          }
        : { cell_type: 'markdown', metadata: {}, source: cell.markdown }
    ),
    metadata: {
      kernelspec,
      language_info: { name: kernelspec.language }
    },
    nbformat: 4,
    nbformat_minor: 5
  };
  await page.contents.uploadContent(JSON.stringify(content), 'text', path);
  await page.notebook.openByPath(path);
  // wait until the content of the file was loaded into the model
  await page.waitForFunction(
    target =>
      Array.from(window.jupyterapp.shell.widgets('main')).some(
        (widget: any) =>
          widget.context?.path === target && widget.context.isReady
      ),
    path
  );
};

/**
 * Dismiss the kernel selection dialog shown when the kernel of the notebook is
 * not installed, keeping the notebook open without a kernel.
 */
const dismissKernelSelection = async (page: IJupyterLabPageFixture) => {
  const dialog = page.locator('.jp-Dialog');
  await dialog.waitFor();
  await dialog.locator('.jp-Dialog-button', { hasText: 'No Kernel' }).click();
  await dialog.waitFor({ state: 'detached' });
};

/**
 * Wait for a command to be registered.
 *
 * The formatter-specific commands are only added once the list of the
 * available formatters was fetched from the server.
 */
const waitForCommand = async (
  page: IJupyterLabPageFixture,
  command: string
) => {
  await page.waitForFunction(
    id => window.jupyterapp.commands.hasCommand(id),
    command
  );
};

/**
 * Execute a command as a programmatic caller would, returning its result.
 */
const executeCommand = async (
  page: IJupyterLabPageFixture,
  command: string,
  args: Record<string, unknown> = {}
) => {
  await waitForCommand(page, command);
  return page.evaluate(
    options =>
      window.jupyterapp.commands.execute(options.command, options.args),
    { command, args }
  );
};

test.describe('Activation', () => {
  /**
   * Don't load JupyterLab webpage before running the tests.
   * This is required to ensure we capture all log messages.
   */
  test.use({ autoGoto: false });

  test('should emit an activation console message', async ({ page }) => {
    const logs: string[] = [];

    page.on('console', message => {
      logs.push(message.text());
    });

    await page.goto();

    expect(
      logs.filter(
        s =>
          s === 'JupyterLab extension jupyterlab_code_formatter is activated!'
      )
    ).toHaveLength(1);
  });
});

test.describe('Commands', () => {
  test('`format_all` formats all code cells', async ({ page, tmpPath }) => {
    const path = `${tmpPath}/format_all.ipynb`;
    await openNotebook(page, path, [
      'x  =  {"a":1}',
      'y = [1, 2]',
      { markdown: 'A  markdown  cell' }
    ]);

    const result = await executeCommand(
      page,
      'jupyterlab_code_formatter:format_all'
    );

    expect(result).toEqual({
      path,
      formatters: ['isort', 'black'],
      // the markdown cell is not considered
      considered: 2,
      // the second cell was already formatted
      changed: 1,
      errors: []
    });
    expect(await page.notebook.getCellTextInput(0)).toBe('x = {"a": 1}');
    expect(await page.notebook.getCellTextInput(1)).toBe('y = [1, 2]');
  });

  test('`format` formats the active cell only', async ({ page, tmpPath }) => {
    const path = `${tmpPath}/format.ipynb`;
    await openNotebook(page, path, ['a  =  1', 'b  =  2']);

    const result = await executeCommand(
      page,
      'jupyterlab_code_formatter:format'
    );

    expect(result).toEqual({
      path,
      formatters: ['isort', 'black'],
      considered: 1,
      changed: 1,
      errors: []
    });
    expect(await page.notebook.getCellTextInput(0)).toBe('a = 1');
    expect(await page.notebook.getCellTextInput(1)).toBe('b  =  2');
  });

  test('`black` formats the notebook given by the `path` argument', async ({
    page,
    tmpPath
  }) => {
    const path = `${tmpPath}/target.ipynb`;
    await openNotebook(page, path, ['a  =  1']);
    await openNotebook(page, `${tmpPath}/other.ipynb`, ['b  =  2']);
    expect(await page.notebook.isActive('other.ipynb')).toBe(true);

    const result = await executeCommand(
      page,
      'jupyterlab_code_formatter:black',
      { path }
    );

    expect(result).toEqual({
      path,
      formatters: ['black'],
      considered: 1,
      changed: 1,
      errors: []
    });
    // the active notebook should be left untouched
    expect(await page.notebook.getCellTextInput(0)).toBe('b  =  2');
    await page.notebook.activate('target.ipynb');
    expect(await page.notebook.getCellTextInput(0)).toBe('a = 1');
  });

  test('`black` formats the active file editor', async ({ page, tmpPath }) => {
    const path = `${tmpPath}/sample.py`;
    await page.contents.uploadContent('a  =  1\n', 'text', path);
    await page.filebrowser.open(path);

    const result = await executeCommand(
      page,
      'jupyterlab_code_formatter:black'
    );

    expect(result).toEqual({
      path,
      formatters: ['black'],
      considered: 1,
      changed: 1,
      errors: []
    });
    expect(await page.locator('.jp-FileEditor .cm-content').textContent()).toBe(
      'a = 1'
    );
  });

  test('commands reject when the document is not open', async ({ page }) => {
    await expect(
      executeCommand(page, 'jupyterlab_code_formatter:format_all', {
        path: 'not-open.ipynb'
      })
    ).rejects.toThrow(/Could not find an open notebook with path/);

    // the failure should also be reported to the user
    await expect(page.locator('.jp-Dialog')).toContainText(
      'Could not find an open notebook with path: not-open.ipynb'
    );
    await page.locator('.jp-Dialog .jp-Dialog-button').click();
  });

  test('commands reject invalid arguments', async ({ page }) => {
    for (const args of [{ path: null }, { path: 1 }, { showDialogs: 'yes' }]) {
      await expect(
        executeCommand(page, 'jupyterlab_code_formatter:format_all', args)
      ).rejects.toThrow(/argument has to be a/);
    }
    // invalid arguments are a programming error: they are not shown in a dialog
    expect(await page.locator('.jp-Dialog').count()).toBe(0);
  });

  test('`showDialogs: false` returns the formatter errors instead of showing them', async ({
    page,
    tmpPath
  }) => {
    const path = `${tmpPath}/with_error.ipynb`;
    await openNotebook(page, path, ['x ==== 1', 'y  =  2']);

    // without `showDialogs: false` this would wait for the user to dismiss a dialog
    const result = await executeCommand(
      page,
      'jupyterlab_code_formatter:format_all',
      { path, showDialogs: false }
    );

    expect(result.considered).toBe(2);
    expect(result.changed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ index: 0, formatter: 'black' });
    expect(await page.locator('.jp-Dialog').count()).toBe(0);
    // the cell which could be formatted should still be formatted
    expect(await page.notebook.getCellTextInput(1)).toBe('y = 2');
  });

  test('commands describe their arguments', async ({ page }) => {
    await waitForCommand(page, 'jupyterlab_code_formatter:format_all');

    const description = await page.evaluate(() =>
      window.jupyterapp.commands.describedBy(
        'jupyterlab_code_formatter:format_all'
      )
    );

    const properties = (description.args as any).properties;
    expect(properties.path.type).toBe('string');
    expect(properties.showDialogs.type).toBe('boolean');
  });
});

test.describe('Unavailable formatter', () => {
  test.use({
    mockSettings: {
      ...galata.DEFAULT_SETTINGS,
      'jupyterlab_code_formatter:settings': {
        preferences: { default_formatter: { python: 'asdf' } }
      }
    }
  });

  test('should report the error sent by the server', async ({
    page,
    tmpPath
  }) => {
    const path = `${tmpPath}/unavailable.ipynb`;
    await openNotebook(page, path, ['a  =  1']);

    await expect(
      executeCommand(page, 'jupyterlab_code_formatter:format_all', { path })
    ).rejects.toThrow(/Formatter 'asdf' is unknown/);

    // the failure should also be reported to the user
    await expect(page.locator('.jp-Dialog')).toContainText(
      "Formatter 'asdf' is unknown"
    );
    await page.locator('.jp-Dialog .jp-Dialog-button').click();

    // the cell should be left untouched
    expect(await page.notebook.getCellTextInput(0)).toBe('a  =  1');
  });
});

test.describe('Format on save', () => {
  test.use({
    mockSettings: {
      ...galata.DEFAULT_SETTINGS,
      'jupyterlab_code_formatter:settings': { formatOnSave: true }
    }
  });

  test('should format the notebook when it is saved', async ({
    page,
    tmpPath
  }) => {
    const path = `${tmpPath}/on_save.ipynb`;
    await openNotebook(page, path, ['a  =  1']);

    await page.notebook.save();

    await page.waitForCondition(
      async () => (await page.notebook.getCellTextInput(0)) === 'a = 1'
    );
  });
});

// The default formatter of a notebook is looked up by the language reported by
// its kernel, the case of which does not always match the case of the language
// used as key in the settings (`R` in the defaults, `r` as reported by the
// kernel of an IRkernel notebook). Both spellings should work.
for (const key of ['R', 'r']) {
  test.describe(`Default formatter keyed by \`${key}\``, () => {
    test.use({
      mockSettings: {
        ...galata.DEFAULT_SETTINGS,
        'jupyterlab_code_formatter:settings': {
          preferences: {
            // `black` stands in for an R formatter here: the R formatters
            // require an R installation, and what is under test is the
            // resolution of the language to a formatter, not the formatting.
            default_formatter: { [key]: 'black' }
          }
        }
      }
    });

    test('should format an R notebook', async ({ page, tmpPath }) => {
      const path = `${tmpPath}/r_notebook_${key}.ipynb`;
      await openNotebook(page, path, ['x  =  1'], KERNELSPECS.R);
      await dismissKernelSelection(page);

      const result = await executeCommand(
        page,
        'jupyterlab_code_formatter:format_all',
        { path }
      );

      expect(result).toEqual({
        path,
        formatters: ['black'],
        considered: 1,
        changed: 1,
        errors: []
      });
      expect(await page.notebook.getCellTextInput(0)).toBe('x = 1');
    });
  });
}
