"use client"

import {Label} from "@/components/ui/label";
import {Input} from "@/components/ui/input";
import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {useCallback, useEffect, useRef, useState} from "react";

type LogEntryType = 'info' | 'error' | 'success';

type LogEntry = {
    timestamp: string;
    message: string;
    type: LogEntryType;
}

type MediaMessage = {
    sequenceNumber: number;
    media: {
        track: string;
        chunk: number;
        timestamp: number;
        payload: string; // Base64 encoded ULAW data
    };
    streamSid?: string;
}

type QueuedAudioItem = {
    audioBuffer: AudioBuffer;
    markName: string;
};

export const MediaPhone = () => {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [url, setUrl] = useState<string>("https://voice-agent.anas31.qzz.io/voice/acme-corp");

    // Connection state
    const [isConnected, setIsConnected] = useState<boolean>(false);

    // Text input for direct AI testing (bypasses STT)
    const [textInput, setTextInput] = useState<string>("");

    // Call management
    const isDisconnecting = useRef(false);
    const wsRef = useRef<WebSocket|null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const streamSidRef = useRef<string|null>(null);
    const callSidRef = useRef<string|null>(null);

    // Audio processing refs
    // Output
    const sequenceNumberRef = useRef<number>(0);
    const timestampRef = useRef<number>(0);
    // Input
    const nextStartTimeRef = useRef<number>(0);
    const audioBufferQueueRef = useRef<QueuedAudioItem[]>([]);
    const muLawDecodeTable = useRef<Int16Array|null>(null);
    const pendingMarksRef = useRef<Set<string>>(new Set());
    const currentSourceRef = useRef<AudioBufferSourceNode|null>(null);
    const pendingMarkFromServerRef = useRef<string|null>(null);
    const ulawDecoderNodeRef = useRef<AudioWorkletNode|null>(null);
    const [isPlaying, setIsPlaying] = useState<boolean>(false);

    // Defense-in-depth: mute outgoing mic data while AI audio is playing.
    // The server also drops media during SPEAKING state, but this prevents
    // the client from wasting bandwidth (and avoids any edge-case echo).
    const isAiSpeakingRef = useRef<boolean>(false);

    // Toggle mic: only send audio while mic is enabled.
    const [isMicEnabled, setIsMicEnabled] = useState<boolean>(false);
    const isMicEnabledRef = useRef<boolean>(false);  // synced copy for encoder
    const [isServerMicLocked, setIsServerMicLocked] = useState<boolean>(false);
    const isServerMicLockedRef = useRef<boolean>(false);

    /**
     * == UTILITY FUNCTIONS ==
     */
    const addLog = useCallback((message: string, type: LogEntryType = 'info') => {
        const timestamp = new Date().toLocaleTimeString();
        setLogs(prev => [...prev.slice(-49), {
            timestamp,
            message,
            type
        }]);
    }, []);

    const generateStreamSid = () => {
        return 'MZ' + Math.random().toString(36).substring(2, 15);
    };

    const generateCallSid = () => {
        return 'CA' + Math.random().toString(36).substring(2, 15);
    }

    const extractStreamUrlFromTwiml = (twimlXml: string) => {
        try {
            // Parse the XML to extract the Stream URL
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(twimlXml, 'text/xml');

            // Find the Stream element and get its url attribute
            const streamElement = xmlDoc.querySelector('Stream');
            if (streamElement) {
                const streamUrl = streamElement.getAttribute('url');
                addLog(`Found stream URL in TwiML: ${streamUrl}`);
                return streamUrl;
            } else {
                addLog('No Stream element found in TwiML', 'error');
                return null;
            }
        } catch (error: any) {
            addLog(`Error parsing TwiML: ${error.message}`, 'error');
            return null;
        }
    }

    /**
     * == ULAW HANDLING FUNCS ==
     */
    const base64ToUint8Array = (base64: string): Uint8Array => {
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    };

    /**
     * == AUDIO PROCESSING ==
     */

    const clearAudioBuffer = () => {
        if (currentSourceRef.current) {
            currentSourceRef.current.stop();
            currentSourceRef.current = null;
        }

        if (ulawDecoderNodeRef.current) {
            ulawDecoderNodeRef.current.port.postMessage({
                type: 'clear'
            });
            addLog('Sent clear message to audio worklet', 'info');
        }

        pendingMarksRef.current.forEach(markName => {
            _sendMessageToClient(
                'mark',
                {
                    event: 'mark',
                    streamSid: streamSidRef.current,
                    sequenceNumber: Date.now().toString(),
                    mark: {
                        name: markName
                    }
                }
            )
        })

        audioBufferQueueRef.current = []
        pendingMarksRef.current.clear()
        nextStartTimeRef.current = audioContextRef.current ? audioContextRef.current.currentTime : 0;
        setIsPlaying(false);
    }

    const processMediaMessage = (message: MediaMessage) => {
        try {
            const muLawData = base64ToUint8Array(message.media.payload);
            
            if (ulawDecoderNodeRef.current) {
                const markName = pendingMarkFromServerRef.current;
                pendingMarkFromServerRef.current = null;
                
                // Send to decoder processor node
                ulawDecoderNodeRef.current.port.postMessage({
                    type: 'decode',
                    ulawData: muLawData,
                    markName,
                    sequenceNumber: message.sequenceNumber || message.media.chunk
                });
                addLog(`Queued ${muLawData.length} bytes in decoder worklet`, 'info');
            }
        } catch (error: any) {
            addLog(`Error processing media message: ${error.message}`, 'error');
        }
    }

    /**
     * == ./AUDIO PROCESSING ==
     */

    /**
     * Request microphone and audio permissions, and initialize the audio context.
     */
    const _initializeAudioContext = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    sampleRate: 8000,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                }
            });

            audioContextRef.current = new AudioContext({sampleRate: 8000});

            if (audioContextRef.current.state === 'suspended') {
                await audioContextRef.current.resume();
                addLog('Audio context resumed', 'info');
            }

            await audioContextRef.current.audioWorklet.addModule('worklet/ulaw-processor.js');
            await audioContextRef.current.audioWorklet.addModule('worklet/ulaw-decoder-processor.js');
            addLog('Audio worklet processors loaded', 'info');

            const source = audioContextRef.current.createMediaStreamSource(stream)
            const encoderWorkletNode = new AudioWorkletNode(audioContextRef.current, 'ulaw-processor');

            encoderWorkletNode.port.onmessage = (event: MessageEvent) => {
                // Drop mic data while AI is speaking (defense-in-depth).
                if (isAiSpeakingRef.current) return;

                // Server-controlled lock: do not send mic audio while a command
                // is being transcribed, answered, or played back.
                if (isServerMicLockedRef.current) return;

                // Push-to-talk: only send audio while mic button is held.
                if (!isMicEnabledRef.current) return;

                if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && streamSidRef.current) {
                    const ulawBytes: Uint8Array = event.data;
                    const base64 = btoa(String.fromCharCode(...ulawBytes))

                    _sendMessageToClient('media', {
                        sequenceNumber: sequenceNumberRef.current++,
                        media: {
                            track: 'inbound',
                            chunk: sequenceNumberRef.current,
                            timestamp: timestampRef.current,
                            payload: base64,
                        }
                    })
                }
            }

            // Output processing decoder
            const decoderWorkletNode = new AudioWorkletNode(audioContextRef.current, 'ulaw-decoder-processor', {
                numberOfInputs: 0,
                numberOfOutputs: 1,
                outputChannelCount: [1]
            });
            ulawDecoderNodeRef.current = decoderWorkletNode;
            
            // Connect the decoder directly to the audio output
            decoderWorkletNode.connect(audioContextRef.current.destination);
            
            decoderWorkletNode.port.onmessage = (event: MessageEvent) => {
                if (event.data.type === 'bufferProcessed') {
                    const { markName } = event.data;
                    
                    if (markName) {
                        _sendMessageToClient(
                            'mark',
                            {
                                event: 'mark',
                                streamSid: streamSidRef.current,
                                sequenceNumber: Date.now().toString(),
                                mark: {
                                    name: markName
                                }
                            }
                        );
                        addLog(`Mark processed: ${markName}`, 'success');
                    }

                    // AI audio playback finished — re-enable mic encoder.
                    // Only re-enable if the queue is empty (no more AI audio pending).
                    if (audioBufferQueueRef.current.length === 0) {
                        isAiSpeakingRef.current = false;
                        addLog('AI playback complete — mic re-enabled', 'info');
                    }
                } else if (event.data.type === 'bufferQueued') {
                    if (event.data.queueLength > 5) {
                        addLog(`Audio queue length: ${event.data.queueLength}`, 'info');
                    }
                } else if (event.data.type === 'cleared') {
                    addLog('Audio worklet buffers cleared', 'info');
                }
            };
            
            // Connect encoder to worklet ONLY (do NOT route mic to speakers).
            // The AI audio is played separately through ulawDecoderNode → destination.
            // Routing mic to speakers creates a local feedback loop (echo).
            source.connect(encoderWorkletNode);

            addLog('Audio processing pipeline set up', 'success');
            nextStartTimeRef.current = audioContextRef.current.currentTime;

            return true;
        } catch (error: any) {
            addLog(`Failed to initialize audio context: ${error.message}`, 'error');
            return false;
        }
    }

    const _getStreamDestination = async () => {
        try {
            addLog(`Initializing connection to media server at ${url}`, 'info');

            callSidRef.current = generateCallSid();

            const response = await fetch(`${url}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                // Send typical Twilio webhook parameters
                // TODO: Make these configurable inputs from the UI
                body: new URLSearchParams({
                    'CallSid': callSidRef.current,
                    'Caller': '+44234567890',
                    'Called': '+44987654321',
                    'CallStatus': 'in-progress',
                    'CallerCountry': 'UK',
                    'AccountSid': 'AC' + Math.random().toString(36).substring(2, 15),
                    'Direction': 'inbound'
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to make initial connect to media server, status: ${response.status}`);
            }

            const twimlResponse = await response.text();
            addLog('Received steam connection response from media server', 'success');

            const streamUri = extractStreamUrlFromTwiml(twimlResponse);
            if (!streamUri) {
                throw new Error('No stream URL found in TwiML response');
            }

            return streamUri;
        } catch (error: any) {
            addLog(`Failed to connect to media server: ${error.message}`, 'error');
            throw error;
        }
    }

    /**
     * == WEBSOCKET CONNECTION ==
     */
    const _connectToMediaStream = async (streamUri: string) => {
        addLog(`Connecting to media stream at ${streamUri}`, 'info');
        console.log('[WS] Connecting to:', streamUri);

        let connectionTimeout: ReturnType<typeof setTimeout> | null = setTimeout(() => {
            connectionTimeout = null;
            if (wsRef.current && wsRef.current.readyState !== WebSocket.OPEN) {
                const state = wsRef.current.readyState;
                addLog(`Connection timed out after 10s (readyState=${state})`, 'error');
                wsRef.current.close();
            }
        }, 10000);

        wsRef.current = new WebSocket(streamUri);

        wsRef.current.addEventListener("open", () => {
            if (connectionTimeout) { clearTimeout(connectionTimeout); connectionTimeout = null; }
            addLog('Media server connection established', 'success');

            // Let server know we are ready to start the call
            setTimeout(() => {
                _sendMessageToClient(
                    'connected',
                    {
                        protocol: 'Call',
                        version: '1.0.0'
                    }
                )

                _startCall();
            }, 500); // Wait a bit to ensure connection is stable
        })

        wsRef.current.addEventListener("close", (event: CloseEvent) => {
            if (connectionTimeout) { clearTimeout(connectionTimeout); connectionTimeout = null; }
            console.log(`[WS] Closed — code=${event.code} reason="${event.reason}" wasClean=${event.wasClean}`);

            if (isDisconnecting.current) {
                // User-initiated disconnect
                addLog(`🔌 Disconnected by user`, 'info');
            } else if (event.code === 4001) {
                addLog(`🔒 Disconnected: authentication failed (bad token)`, 'error');
            } else if (event.code === 1006) {
                addLog(`⚠️  Disconnected: abnormal closure — likely proxy/network issue (code 1006)`, 'error');
            } else if (event.wasClean) {
                addLog(`🔌 Disconnected cleanly (code=${event.code})`, 'info');
            } else {
                addLog(`❌ Disconnected unexpectedly: code=${event.code} reason="${event.reason || 'none'}"`, 'error');
            }

            setIsConnected(false);
        })

        wsRef.current.addEventListener("message", _handleWebSocketMessage)

        wsRef.current.addEventListener("error", (error: Event) => {
            if (connectionTimeout) { clearTimeout(connectionTimeout); connectionTimeout = null; }
            console.error('[WS] Error event — full details:', error);
            // The error event carries no useful info itself; the close event will follow with the actual code.
            addLog(`⚠️  WebSocket error — close event will follow with details`, 'error');
        })
    }

    const _handleWebSocketMessage = useCallback((event: MessageEvent) => {
        try {
            const message = JSON.parse(event.data);
            addLog(`Received ${message.event}`, 'info')

            switch (message.event) {
                case 'media':
                    // AI audio is arriving — mute the mic encoder until playback finishes.
                    isAiSpeakingRef.current = true;
                    processMediaMessage(message);
                    break;

                case 'mark':
                    if (!message.mark?.name) return;
                    pendingMarkFromServerRef.current = message.mark.name;
                    addLog(`Mark received: ${message.mark.name}`);
                    break;

                case 'clear':
                    addLog('Clear received - stopping audio playback');
                    isAiSpeakingRef.current = false;
                    clearAudioBuffer();
                    break;

                case 'ping':
                    // Keepalive from server — respond with pong
                    if (wsRef.current?.readyState === WebSocket.OPEN) {
                        wsRef.current.send(JSON.stringify({ event: 'pong' }));
                    }
                    break;

                case 'pong':
                    // Keepalive response — nothing to do
                    break;

                case 'transcription':
                    addLog(`📝 STT: "${message.text}" (${message.language}, conf: ${message.confidence})`, 'success');
                    break;

                case 'processing':
                    addLog(`⏳ ${message.message || 'Command is processing'}`, 'info');
                    break;

                case 'response':
                    addLog(`🤖 AI: "${message.text}"`, 'info');
                    break;

                case 'ai_core':
                    addLog(
                        message.message || (
                            message.reachable
                                ? 'AI Core reachable. Commands will use AI Core first.'
                                : 'AI Core unavailable. Commands will still try AI Core before fallback.'
                        ),
                        message.reachable ? 'success' : 'error'
                    );
                    break;

                case 'mic': {
                    const locked = message.enabled === false;
                    isServerMicLockedRef.current = locked;
                    setIsServerMicLocked(locked);
                    addLog(
                        locked
                            ? '🔇 Mic disabled while previous command is processing'
                            : '🎤 Mic available for next command',
                        'info'
                    );
                    break;
                }

                case 'ready':
                    isServerMicLockedRef.current = false;
                    setIsServerMicLocked(false);
                    addLog(`✅ ${message.message || 'Ready for your next command.'}`, 'success');
                    break;

                case 'busy':
                    addLog('⏳ Busy — still processing previous response, ignoring input', 'error');
                    break;
            }

        } catch (error: any) {
            addLog(`Unknown message type: ${error.message}`, 'error');
        }
    }, [addLog])

    const _startCall = () => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
            addLog('WebSocket is not connected. Cannot start call.', 'error');
            return;
        }

        const streamSid = generateStreamSid();

        streamSidRef.current = streamSid;
        sequenceNumberRef.current = 0;
        timestampRef.current = 0;

        _sendMessageToClient(
            'start',
            {
                sequenceNumber: 1,
                start: {
                    streamSid: streamSidRef.current,
                    callSid: callSidRef.current,
                    tracks: ['inbound', 'outbound'],
                    mediaFormat: {
                        encoding: 'audio/x-mulaw',
                        sampleRate: 8000,
                        channels: 1
                    }
                },
                streamSid: streamSidRef.current
            }
        );
        addLog(`Sent start, streamSid: ${streamSid}`, 'info');
    }

    const _closeMediaServerConnection = (statusCode: number, statusMessage: string) => {
        if (!wsRef.current) return;
        wsRef.current.close(statusCode, statusMessage);
        wsRef.current = null;
    };

    /**
     * == ./WEBSOCKET CONNECTION ==
     */

    /**
     * Connects to the websocket server and starts a new call stream.
     */
    const _connectToCall = async () => {
        console.log('Connecting to call with URL:', url);

        if (isConnected) return;

        isDisconnecting.current = false;

        addLog('Connecting to audio devices', 'info');

        const audioContextInitialized = await _initializeAudioContext();
        if (!audioContextInitialized) {
            addLog('Failed to initialize audio context. Cannot connect to call.', 'error');
            return;
        }

        const streamUri = await _getStreamDestination();
        addLog(`Stream URI: ${streamUri}`, 'info');

        await _connectToMediaStream(streamUri);

        setIsConnected(true)

        console.log('Connect to server via HTTP/WS');
    }

    /**
     * Clean up and disconnect from the call.
     */
    const _disconnectFromCall = () => {
        if (isDisconnecting.current) return;
        isDisconnecting.current = true;  // signal to close handler that this is intentional

        addLog('🔌 Disconnecting from call…', 'info');

        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            _sendMessageToClient(
                'stop',
                {
                    sequenceNumber: sequenceNumberRef.current++,
                    stop: {
                        callSid: callSidRef.current
                    },
                    streamSid: streamSidRef.current
                }
            );

            // Give the stop message a moment to send, then close cleanly
            setTimeout(() => {
                _closeMediaServerConnection(1000, 'User disconnected');
            }, 150);
        } else if (wsRef.current) {
            // Already closing/closed — force cleanup
            _closeMediaServerConnection(1000, 'User disconnected');
        }

        ulawDecoderNodeRef.current = null;
        
        if (audioContextRef.current) {
            try {
                audioContextRef.current.close();
                audioContextRef.current = null;
            } catch (_) {
                audioContextRef.current = null;
            }
        }
    }

    const _sendMessageToClient = (event: string, data: Record<string, any>) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
            addLog('WebSocket is not connected. Cannot send message.', 'error');
            return;
        }

        const message = {
            event,
            ...data
        };

        wsRef.current?.send(JSON.stringify(message));
    }

    const _sendText = () => {
        const trimmed = textInput.trim();
        if (!trimmed || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

        _sendMessageToClient('text', { text: trimmed });
        addLog(`⌨️ Sent: "${trimmed}"`, 'info');
        setTextInput('');
    }

    /**
     * == RENDER UI ==
     */

    useEffect(() => {
        return () => {
            isDisconnecting.current = true;
            _disconnectFromCall();
        }
    }, []);

    return (
        <>
            <div className="bg-gray-100 p-4 rounded">
                <div className="flex flex-col gap-2">
                    <Label>Connection url</Label>
                    <Input type="text" className="bg-white" placeholder="https://voice-agent.anas31.qzz.io/voice/acme-corp" value={url}
                           onChange={(e) => setUrl(e.target.value)}/>
                </div>
            </div>
            <div className="bg-gray-50 flex flex-row items-center p-4 rounded mt-4 gap-2">
                <Label>Status:</Label>
                <Badge
                    variant={isConnected ? 'default' : 'secondary'}>{isConnected ? 'Connected' : 'Disconnected'}</Badge>
            </div>
            <div className="bg-gray-50 flex flex-row items-center p-4 rounded mt-4 gap-2">
                <Button onClick={() => _connectToCall()}>Connect to call</Button>
                <Button variant="secondary" onClick={() => _disconnectFromCall()}>Disconnect</Button>
                <Button
                    variant="outline"
                    className={isMicEnabled
                        ? "bg-green-500 hover:bg-green-600 text-white border-0 min-w-24"
                        : "bg-red-500 hover:bg-red-600 text-white border-0 min-w-24"
                    }
                    disabled={isServerMicLocked}
                    onClick={() => {
                        const next = !isMicEnabled;
                        isMicEnabledRef.current = next;
                        setIsMicEnabled(next);
                        addLog(next ? '🎤 Mic ON' : '🔇 Mic OFF', 'info');
                    }}
                >
                    {isServerMicLocked ? "⏳ Processing" : isMicEnabled ? "🎤 Mic ON" : "🎤 Mic OFF"}
                </Button>
            </div>
            {isServerMicLocked && (
                <div className="bg-amber-50 border border-amber-200 text-amber-900 p-3 rounded mt-4 text-sm">
                    Previous command is processing. Mic is temporarily disabled.
                </div>
            )}
            <div className="bg-gray-50 flex flex-row items-center p-4 rounded mt-4 gap-2">
                <Input
                    type="text"
                    className="bg-white flex-1"
                    placeholder="Type a message to send to AI (skips STT)..."
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && _sendText()}
                    disabled={isServerMicLocked}
                />
                <Button
                    variant="outline"
                    onClick={_sendText}
                    disabled={!isConnected || isServerMicLocked}
                >
                    ⌨️ Send
                </Button>
            </div>

            <div className="bg-white border-1 border-gray-200 rounded mt-4">
                <div className="p-4 border-b border-gray-200">
                    <span className="text-sm font-bold">Logs</span>
                </div>
                <div className="p-4 text-sm">
                    <div className="p-4 max-h-64 overflow-y-auto">
                        {logs.length === 0 ? (
                            <p className="text-gray-500 text-sm">No logs yet...</p>
                        ) : (
                            <div className="space-y-1">
                                {logs.map((log, index) => (
                                    <div key={index} className="text-sm font-mono">
                                        <span className="text-gray-500">{log.timestamp}</span>
                                        <span className={`ml-2 ${log.type === 'error' ? 'text-red-600' :
                                            log.type === 'success' ? 'text-green-600' :
                                                'text-gray-800'
                                        }`}>
                                            {log.message}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    )
}
