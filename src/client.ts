import { URLExt } from '@jupyterlab/coreutils';
import { ServerConnection } from '@jupyterlab/services';
import { Constants } from './constants';

class JupyterlabCodeFormatterClient {
  public request(path: string, method: string, body: any): Promise<any> {
    const settings = ServerConnection.makeSettings();
    const fullUrl = URLExt.join(settings.baseUrl, Constants.PLUGIN_NAME, path);
    return ServerConnection.makeRequest(
      fullUrl,
      {
        body,
        method
      },
      settings
    ).then(async response => {
      if (response.status !== 200) {
        // `create` extracts the `message` of the JSON error response sent by
        // the server, falling back on the status code if there is none.
        throw await ServerConnection.ResponseError.create(response);
      }
      return response.text();
    });
  }

  public getAvailableFormatters(cache: boolean) {
    return this.request('formatters' + (cache ? '?cached' : ''), 'GET', null);
  }
}

export default JupyterlabCodeFormatterClient;
