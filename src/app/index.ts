import '../style/app.css';
import { StreamClientScrcpy } from './googDevice/client/StreamClientScrcpy';
import { HostTracker } from './client/HostTracker';
import { Tool } from './client/Tool';

window.onload = async function (): Promise<void> {
    /// #if USE_BROADWAY
    const { BroadwayPlayer } = await import('./player/BroadwayPlayer');
    StreamClientScrcpy.registerPlayer(BroadwayPlayer);
    /// #endif

    /// #if USE_H264_CONVERTER
    const { MsePlayer } = await import('./player/MsePlayer');
    StreamClientScrcpy.registerPlayer(MsePlayer);
    /// #endif

    /// #if USE_TINY_H264
    const { TinyH264Player } = await import('./player/TinyH264Player');
    StreamClientScrcpy.registerPlayer(TinyH264Player);
    /// #endif

    /// #if USE_WEBCODECS
    const { WebCodecsPlayer } = await import('./player/WebCodecsPlayer');
    StreamClientScrcpy.registerPlayer(WebCodecsPlayer);
    /// #endif

    /// #if INCLUDE_APPL
    {
        const { DeviceTracker } = await import('./applDevice/client/DeviceTracker');

        /// #if USE_QVH_SERVER
        const { StreamClientQVHack } = await import('./applDevice/client/StreamClientQVHack');

        DeviceTracker.registerTool(StreamClientQVHack);

        /// #if USE_WEBCODECS
        const { WebCodecsPlayer } = await import('./player/WebCodecsPlayer');
        StreamClientQVHack.registerPlayer(WebCodecsPlayer);
        /// #endif

        /// #if USE_H264_CONVERTER
        const { MsePlayerForQVHack } = await import('./player/MsePlayerForQVHack');
        StreamClientQVHack.registerPlayer(MsePlayerForQVHack);
        /// #endif
        /// #endif

        /// #if USE_WDA_MJPEG_SERVER
        const { StreamClientMJPEG } = await import('./applDevice/client/StreamClientMJPEG');
        DeviceTracker.registerTool(StreamClientMJPEG);

        const { MjpegPlayer } = await import('./player/MjpegPlayer');
        StreamClientMJPEG.registerPlayer(MjpegPlayer);
        /// #endif
    }
    /// #endif

    const tools: Tool[] = [];

    /// #if INCLUDE_ADB_SHELL
    const { ShellClient } = await import('./googDevice/client/ShellClient');
    tools.push(ShellClient);
    /// #endif

    /// #if INCLUDE_DEV_TOOLS
    const { DevtoolsClient } = await import('./googDevice/client/DevtoolsClient');
    tools.push(DevtoolsClient);
    /// #endif

    /// #if INCLUDE_FILE_LISTING
    const { FileListingClient } = await import('./googDevice/client/FileListingClient');
    tools.push(FileListingClient);
    /// #endif

    if (tools.length) {
        const { DeviceTracker } = await import('./googDevice/client/DeviceTracker');
        tools.forEach((tool) => {
            DeviceTracker.registerTool(tool);
        });
    }

    const applyFocusMode = (): void => {
        const hash = location.hash.replace(/^#!/, '');
        const parsedQuery = new URLSearchParams(hash);
        const focus = (parsedQuery.get('focus') || '').toLowerCase();
        if (focus === 'chat') {
            document.body.classList.add('chat-focus-mode');
            const devicesRoot = document.getElementById('devices');
            if (devicesRoot) {
                devicesRoot.classList.add('chat-focus-hidden');
            }
        } else {
            document.body.classList.remove('chat-focus-mode');
            const devicesRoot = document.getElementById('devices');
            if (devicesRoot) {
                devicesRoot.classList.remove('chat-focus-hidden');
            }
        }
    };

    HostTracker.start();
    applyFocusMode();

    const handleHashAction = async (): Promise<void> => {
        const hash = location.hash.replace(/^#!/, '');
        const parsedQuery = new URLSearchParams(hash);
        const action = parsedQuery.get('action');

        if (action === StreamClientScrcpy.ACTION && typeof parsedQuery.get('udid') === 'string') {
            StreamClientScrcpy.start(parsedQuery);
            return;
        }

        /// #if INCLUDE_APPL
        /// #if USE_QVH_SERVER
        {
            const { StreamClientQVHack } = await import('./applDevice/client/StreamClientQVHack');
            if (action === StreamClientQVHack.ACTION && typeof parsedQuery.get('udid') === 'string') {
                StreamClientQVHack.start(StreamClientQVHack.parseParameters(parsedQuery));
                return;
            }
        }
        /// #endif

        /// #if USE_WDA_MJPEG_SERVER
        {
            const { StreamClientMJPEG } = await import('./applDevice/client/StreamClientMJPEG');
            if (action === StreamClientMJPEG.ACTION && typeof parsedQuery.get('udid') === 'string') {
                StreamClientMJPEG.start(StreamClientMJPEG.parseParameters(parsedQuery));
                return;
            }
        }
        /// #endif
        /// #endif

        /// #if INCLUDE_ADB_SHELL
        {
            const { ShellClient } = await import('./googDevice/client/ShellClient');
            if (action === ShellClient.ACTION && typeof parsedQuery.get('udid') === 'string') {
                ShellClient.start(ShellClient.parseParameters(parsedQuery));
                return;
            }
        }
        /// #endif

        /// #if INCLUDE_DEV_TOOLS
        {
            const { DevtoolsClient } = await import('./googDevice/client/DevtoolsClient');
            if (action === DevtoolsClient.ACTION) {
                DevtoolsClient.start(DevtoolsClient.parseParameters(parsedQuery));
                return;
            }
        }
        /// #endif

        /// #if INCLUDE_FILE_LISTING
        {
            const { FileListingClient } = await import('./googDevice/client/FileListingClient');
            if (action === FileListingClient.ACTION) {
                FileListingClient.start(FileListingClient.parseParameters(parsedQuery));
                return;
            }
        }
        /// #endif
    };

    window.onhashchange = () => {
        applyFocusMode();
        void handleHashAction();
    };

    await handleHashAction();
};
