"use client"

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Phone, PhoneOff, Loader2, MessageSquare, Activity, Terminal, AlertCircle } from "lucide-react";

type LogCategory = 'system' | 'event' | 'transcription' | 'ai_response' | 'diagnostic' | 'error';
type LogEntryType = 'info' | 'error' | 'success';

type LogEntry = {
    id: string;
    timestamp: string;
    message: string;
    type: LogEntryType;
    category: LogCategory;
    details?: any;
    totalLatencyMs?: number;
    backendLatencyMs?: number;
    rawText?: string;
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

const ThinkingBubble = () => {
    const [dots, setDots] = useState('');
    const phrases = ["Thinking", "Searching through the registers", "Analyzing intent", "Formulating response"];
    const [phraseIndex, setPhraseIndex] = useState(0);

    useEffect(() => {
        const dotInterval = setInterval(() => {
            setDots(prev => prev.length >= 3 ? '' : prev + '.');
        }, 500);
        const phraseInterval = setInterval(() => {
            setPhraseIndex(prev => (prev + 1) % phrases.length);
        }, 2000);
        return () => {
            clearInterval(dotInterval);
            clearInterval(phraseInterval);
        };
    }, []);

    return <span>{phrases[phraseIndex]}{dots}</span>;
}

export const MediaPhone = () => {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [url, setUrl] = useState<string>("https://voice-agent.anas31.qzz.io/voice/acme-corp");
    const [activeDepartment, setActiveDepartment] = useState<string>("");

    // Connection state
    const [isConnected, setIsConnected] = useState<boolean>(false);

    // Text input for direct AI testing (bypasses STT)
    const [textInput, setTextInput] = useState<string>("");

    const [activeTab, setActiveTab] = useState<'logs' | 'stats'>('logs');
    const lastSttTimestampRef = useRef<number | null>(null);
    const [panelWidth, setPanelWidth] = useState(450);

    // Diagnostics State
    const [aiCoreUrl, setAiCoreUrl] = useState<string>(process.env.NEXT_PUBLIC_AI_CORE_URL || "https://api.operaios.qzz.io");
    const [apiKey, setApiKey] = useState<string>("dev-secret");
    const [diagnosticCallSid, setDiagnosticCallSid] = useState<string>("");
    const [isFetchingDiagnostics, setIsFetchingDiagnostics] = useState<boolean>(false);

    // Call management
    const isDisconnecting = useRef(false);
    const wsRef = useRef<WebSocket | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const streamSidRef = useRef<string | null>(null);
    const callSidRef = useRef<string | null>(null);

    // Audio processing refs
    // Output
    const sequenceNumberRef = useRef<number>(0);
    const timestampRef = useRef<number>(0);
    // Input
    const nextStartTimeRef = useRef<number>(0);
    const audioBufferQueueRef = useRef<QueuedAudioItem[]>([]);
    const muLawDecodeTable = useRef<Int16Array | null>(null);
    const pendingMarksRef = useRef<Set<string>>(new Set());
    const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
    const pendingMarkFromServerRef = useRef<string | null>(null);
    const ulawDecoderNodeRef = useRef<AudioWorkletNode | null>(null);
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
    const addLog = useCallback((message: string, type: LogEntryType = 'info', category: LogCategory = 'system', details?: any, rawText?: string) => {
        const timestamp = new Date().toLocaleTimeString();
        setLogs(prev => [...prev.slice(-199), {
            id: Math.random().toString(36).substring(2, 9),
            timestamp,
            message,
            type,
            category: type === 'error' ? 'error' : category,
            details,
            rawText
        }]);
    }, []);

    const generateStreamSid = () => {
        return 'MZ' + Math.random().toString(36).substring(2, 15);
    };

    const generateCallSid = () => {
        return 'CA' + Math.random().toString(36).substring(2, 15);
    }


    const fetchDiagnostics = async (sidToFetch?: string) => {
        const targetSid = sidToFetch || callSidRef.current;
        if (!targetSid) {
            addLog('No Call SID available to fetch diagnostics.', 'error', 'error');
            return;
        }
        if (!aiCoreUrl) {
            addLog('AI Core URL is required to fetch diagnostics.', 'error', 'error');
            return;
        }

        setIsFetchingDiagnostics(true);
        addLog(`Fetching diagnostics for Call SID: ${targetSid}...`, 'info', 'diagnostic');

        try {
            const response = await fetch(`${aiCoreUrl.replace(/\/$/, '')}/api/v1/call/${targetSid}/diagnostics`, {
                headers: {
                    'x-internal-api-key': apiKey
                }
            });

            if (!response.ok) {
                throw new Error(`Server returned ${response.status}`);
            }

            const data = await response.json();
            addLog(`Diagnostics retrieved for ${targetSid}`, 'success', 'diagnostic', data);
        } catch (error: any) {
            addLog(`Failed to fetch diagnostics: ${error.message}`, 'error', 'error');
        } finally {
            setIsFetchingDiagnostics(false);
        }
    };

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

            audioContextRef.current = new AudioContext({ sampleRate: 8000 });

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

            let streamUri = extractStreamUrlFromTwiml(twimlResponse);
            if (!streamUri) {
                throw new Error('No stream URL found in TwiML response');
            }
            if (activeDepartment.trim()) {
                streamUri += `&active_department=${encodeURIComponent(activeDepartment.trim())}`;
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

            if (message.event !== 'media') {
                addLog(`Received ${message.event}: ${JSON.stringify(message)}`, 'info');
            }

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
                    lastSttTimestampRef.current = Date.now();
                    addLog(`📝 STT: "${message.text}" (${message.language}, conf: ${message.confidence})`, 'success', 'transcription', undefined, message.text);
                    break;

                case 'processing':
                    addLog(`⏳ ${message.message || 'Command is processing'}`, 'info');
                    break;

                case 'response': {
                    let totalLatency: number | undefined;
                    if (lastSttTimestampRef.current) {
                        totalLatency = Date.now() - lastSttTimestampRef.current;
                        lastSttTimestampRef.current = null;
                    }
                    const backendLatency = message.backend_latency_ms;
                    
                    const timestampStr = new Date().toLocaleTimeString();
                    setLogs(prev => [...prev.slice(-199), {
                        id: Math.random().toString(36).substring(2, 9),
                        timestamp: timestampStr,
                        message: message.internal_session_id
                            ? `🤖 AI: "${message.text}" (session: ${message.internal_session_id})`
                            : `🤖 AI: "${message.text}"`,
                        type: 'info',
                        category: 'ai_response',
                        totalLatencyMs: totalLatency,
                        backendLatencyMs: backendLatency,
                        rawText: message.text
                    }]);
                    break;
                }

                case 'ai_core':
                    addLog(
                        message.message || (
                            message.reachable
                                ? 'AI Core chat endpoint reachable. Commands will use AI Core first.'
                                : 'AI Core chat endpoint unavailable. Commands will still try AI Core before fallback.'
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
        <div 
            className="flex h-screen w-screen max-h-screen bg-neutral-950 text-neutral-50 font-sans overflow-hidden"
            onMouseMove={(e) => {
                if (isDisconnecting.current && (e.buttons & 1)) {
                    // Re-use isDisconnecting as dragging flag for a quick hack, or add new ref
                    // Actually let's just do it properly
                }
            }}
        >
            {/* MAIN COLUMN: Chat Interface */}
            <div className="flex-1 flex flex-col relative min-w-[300px]">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-neutral-800 bg-neutral-900/50 backdrop-blur-md">
                    <div className="flex items-center gap-3">
                        <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-red-500'}`} />
                        <h1 className="font-semibold text-lg tracking-tight">Voice Agent interaction</h1>
                        <Badge variant="outline" className="ml-2 border-neutral-700 text-neutral-400">
                            {isConnected ? 'Connected' : 'Disconnected'}
                        </Badge>
                    </div>

                    <div className="flex items-center gap-2">
                        {!isConnected ? (
                            <Button onClick={_connectToCall} className="bg-emerald-600 hover:bg-emerald-500 text-white transition-all shadow-[0_0_15px_rgba(5,150,105,0.3)]">
                                <Phone className="w-4 h-4 mr-2" /> Connect
                            </Button>
                        ) : (
                            <Button onClick={_disconnectFromCall} variant="destructive" className="bg-red-600 hover:bg-red-500">
                                <PhoneOff className="w-4 h-4 mr-2" /> Disconnect
                            </Button>
                        )}
                    </div>
                </div>

                {/* Connection Settings */}
                {!isConnected && (
                    <div className="p-4 bg-neutral-900 border-b border-neutral-800 grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <Label className="text-neutral-400 text-xs uppercase tracking-wider">Voice Server URL</Label>
                            <Input
                                className="bg-neutral-950 border-neutral-800 focus:border-neutral-600 focus:ring-neutral-600 text-neutral-200"
                                value={url} onChange={(e) => setUrl(e.target.value)}
                            />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-neutral-400 text-xs uppercase tracking-wider">Department</Label>
                            <Input
                                className="bg-neutral-950 border-neutral-800 focus:border-neutral-600 focus:ring-neutral-600 text-neutral-200"
                                placeholder="optional"
                                value={activeDepartment} onChange={(e) => setActiveDepartment(e.target.value)}
                            />
                        </div>
                    </div>
                )}

                {/* Chat Area */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6 scroll-smooth">
                    {logs.filter(l => l.category === 'transcription' || l.category === 'ai_response').length === 0 && !isServerMicLocked ? (
                        <div className="h-full flex flex-col items-center justify-center text-neutral-600 gap-4">
                            <MessageSquare className="w-12 h-12 opacity-20" />
                            <p className="text-sm uppercase tracking-widest opacity-50">No conversation yet</p>
                        </div>
                    ) : (
                        <>
                            {logs.filter(l => l.category === 'transcription' || l.category === 'ai_response').map(log => (
                                <div key={log.id} className={`flex w-full ${log.category === 'transcription' ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-[80%] rounded-2xl p-4 ${log.category === 'transcription'
                                        ? 'bg-emerald-900/40 text-emerald-100 border border-emerald-800/50 rounded-tr-sm'
                                        : 'bg-neutral-800 border border-neutral-700 text-neutral-200 rounded-tl-sm'}`}>
                                        <div className="flex items-center gap-2 mb-1 opacity-60 text-xs">
                                            <span>{log.category === 'transcription' ? 'You' : 'AI Agent'}</span>
                                            <span className="text-[10px]">{log.timestamp}</span>
                                            {log.totalLatencyMs !== undefined && (
                                                <span className="text-[10px] ml-auto">
                                                    (Total: {log.totalLatencyMs}ms{log.backendLatencyMs !== undefined ? `, Backend: ${log.backendLatencyMs.toFixed(0)}ms` : ''})
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-base leading-relaxed whitespace-pre-wrap">
                                            {log.rawText || log.message}
                                        </div>
                                    </div>
                                </div>
                            ))}
                            {isServerMicLocked && (
                                <div className="flex w-full justify-start">
                                    <div className="max-w-[80%] rounded-2xl p-4 bg-neutral-800 border border-neutral-700 text-neutral-400 rounded-tl-sm">
                                        <div className="flex items-center gap-2 mb-1 opacity-60 text-xs">
                                            <span>AI Agent</span>
                                        </div>
                                        <div className="text-base leading-relaxed italic animate-pulse">
                                            <ThinkingBubble />
                                        </div>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* Control Bar */}
                <div className="p-4 border-t border-neutral-800 bg-neutral-900/80 backdrop-blur-md">
                    <div className="flex items-center gap-4">
                        <Button
                            variant="outline"
                            size="lg"
                            className={`relative overflow-hidden group transition-all duration-300 ${isServerMicLocked ? 'bg-amber-900/20 border-amber-800/50 text-amber-500' :
                                    isMicEnabled
                                        ? 'bg-emerald-600/20 border-emerald-500/50 text-emerald-400 hover:bg-emerald-600/30'
                                        : 'bg-neutral-800 border-neutral-700 hover:bg-neutral-700 text-neutral-400'
                                }`}
                            disabled={isServerMicLocked || !isConnected}
                            onClick={() => {
                                const next = !isMicEnabled;
                                isMicEnabledRef.current = next;
                                setIsMicEnabled(next);
                                addLog(next ? 'Mic ON' : 'Mic OFF', 'info', 'system');
                                if (!next && isConnected && wsRef.current?.readyState === WebSocket.OPEN) {
                                    wsRef.current.send(JSON.stringify({ event: "flush_audio" }));
                                }
                            }}
                        >
                            {isServerMicLocked ? (
                                <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Processing</>
                            ) : isMicEnabled ? (
                                <>
                                    <span className="absolute inset-0 bg-emerald-500/20 animate-pulse" />
                                    <Mic className="w-5 h-5 mr-2 relative z-10" />
                                    <span className="relative z-10">Listening...</span>
                                    {/* Mic Waves */}
                                    <div className="ml-3 flex items-center gap-[2px] relative z-10">
                                        <div className="w-1 h-3 bg-emerald-400 rounded-full animate-[bounce_1s_infinite_100ms]"></div>
                                        <div className="w-1 h-5 bg-emerald-400 rounded-full animate-[bounce_1s_infinite_200ms]"></div>
                                        <div className="w-1 h-2 bg-emerald-400 rounded-full animate-[bounce_1s_infinite_300ms]"></div>
                                        <div className="w-1 h-4 bg-emerald-400 rounded-full animate-[bounce_1s_infinite_400ms]"></div>
                                    </div>
                                </>
                            ) : (
                                <><MicOff className="w-5 h-5 mr-2" /> Mic Off</>
                            )}
                        </Button>

                        <div className="flex-1 relative">
                            <Input
                                type="text"
                                className="w-full bg-neutral-950 text-neutral-200 border-neutral-700 focus:border-neutral-500 pr-20 h-12"
                                placeholder="Type a message (bypasses STT)..."
                                value={textInput}
                                onChange={(e) => setTextInput(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && _sendText()}
                                disabled={isServerMicLocked || !isConnected}
                            />
                            <Button
                                size="sm"
                                className="absolute right-1 top-1 h-10 px-4 bg-neutral-800 text-neutral-200 hover:bg-neutral-700"
                                onClick={_sendText}
                                disabled={!isConnected || isServerMicLocked || !textInput.trim()}
                            >
                                Send
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Resizer */}
            <div 
                className="w-1 bg-neutral-800 hover:bg-neutral-600 cursor-col-resize active:bg-emerald-500 transition-colors z-50 flex-shrink-0"
                onMouseDown={(e) => {
                    const startX = e.clientX;
                    const startWidth = panelWidth;
                    
                    const onMouseMove = (moveEvent: MouseEvent) => {
                        const newWidth = startWidth - (moveEvent.clientX - startX);
                        if (newWidth > 300 && newWidth < window.innerWidth - 400) {
                            setPanelWidth(newWidth);
                        }
                    };
                    
                    const onMouseUp = () => {
                        document.removeEventListener('mousemove', onMouseMove);
                        document.removeEventListener('mouseup', onMouseUp);
                    };
                    
                    document.addEventListener('mousemove', onMouseMove);
                    document.addEventListener('mouseup', onMouseUp);
                }}
            />

            {/* SIDE PANEL: Technical Logs & Stats */}
            <div style={{ width: panelWidth }} className="flex flex-col bg-neutral-900 border-l border-neutral-800 flex-shrink-0 relative">
                <div className="flex border-b border-neutral-800">
                    <button 
                        onClick={() => setActiveTab('logs')}
                        className={`flex-1 p-4 font-semibold text-sm flex items-center justify-center gap-2 transition-colors ${activeTab === 'logs' ? 'bg-neutral-800 text-neutral-200 border-b-2 border-emerald-500' : 'text-neutral-500 hover:text-neutral-300'}`}
                    >
                        <Terminal className="w-4 h-4" /> System Logs
                    </button>
                    <button 
                        onClick={() => setActiveTab('stats')}
                        className={`flex-1 p-4 font-semibold text-sm flex items-center justify-center gap-2 transition-colors ${activeTab === 'stats' ? 'bg-neutral-800 text-neutral-200 border-b-2 border-emerald-500' : 'text-neutral-500 hover:text-neutral-300'}`}
                    >
                        <Activity className="w-4 h-4" /> Call Stats
                    </button>
                </div>

                {activeTab === 'stats' && (
                    <div className="p-4 bg-neutral-950/50 space-y-4 flex-1 overflow-y-auto">
                        <div className="space-y-3">
                            <Label className="text-xs text-neutral-500 uppercase">Diagnostics Fetcher</Label>
                            <div className="space-y-2">
                                <Input size={1} placeholder="AI Core URL" className="h-8 text-xs bg-neutral-900 text-neutral-300 border-neutral-800" value={aiCoreUrl} onChange={e => setAiCoreUrl(e.target.value)} />
                                <Input type="password" size={1} placeholder="API Key" className="h-8 text-xs bg-neutral-900 text-neutral-300 border-neutral-800" value={apiKey} onChange={e => setApiKey(e.target.value)} />
                                <div className="flex gap-2">
                                    <Input
                                        placeholder="Specific Call SID (optional)"
                                        className="h-8 text-xs bg-neutral-900 text-neutral-300 border-neutral-800"
                                        value={diagnosticCallSid}
                                        onChange={e => setDiagnosticCallSid(e.target.value)}
                                    />
                                    <Button
                                        size="sm"
                                        variant="secondary"
                                        className="h-8 text-xs whitespace-nowrap bg-neutral-800 text-neutral-200 hover:bg-neutral-700 border border-neutral-700"
                                        onClick={() => fetchDiagnostics(diagnosticCallSid)}
                                        disabled={isFetchingDiagnostics}
                                    >
                                        {isFetchingDiagnostics ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Activity className="w-3 h-3 mr-1" />} Pull Stats
                                    </Button>
                                </div>
                            </div>
                        </div>

                        {/* Render Diagnostic Logs Here */}
                        <div className="space-y-2 mt-4">
                            {logs.filter(l => l.category === 'diagnostic').reverse().map(log => (
                                <div key={log.id} className="text-xs font-mono p-3 rounded-lg bg-neutral-900 border border-neutral-700 shadow-sm">
                                    <div className="flex justify-between items-start mb-2 opacity-70 text-neutral-300">
                                        <span>{log.timestamp}</span>
                                        <span className="uppercase text-[9px] px-1 rounded bg-blue-900/50 text-blue-300 border border-blue-800/50">Diagnostic</span>
                                    </div>
                                    <div className="text-blue-300 font-semibold mb-2">{log.message}</div>
                                    {log.details && (
                                        <pre className="mt-2 p-3 bg-neutral-950 rounded text-[10px] overflow-x-auto text-neutral-300 border border-neutral-800">
                                            {JSON.stringify(log.details, null, 2)}
                                        </pre>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {activeTab === 'logs' && (
                    <div className="flex-1 overflow-y-auto p-3 space-y-2">
                        {logs.filter(l => l.category !== 'transcription' && l.category !== 'ai_response' && l.category !== 'diagnostic').length === 0 ? (
                            <p className="text-neutral-600 text-xs text-center mt-10">No system events.</p>
                        ) : (
                            [...logs].filter(l => l.category !== 'transcription' && l.category !== 'ai_response' && l.category !== 'diagnostic').reverse().map(log => (
                                <div key={log.id} className="text-xs font-mono p-2 rounded bg-neutral-950/50 border border-neutral-800/50">
                                    <div className="flex justify-between items-start mb-1 opacity-50 text-neutral-300">
                                        <span>{log.timestamp}</span>
                                        <span className="uppercase text-[9px] px-1 rounded bg-neutral-800">{log.category}</span>
                                    </div>
                                    <div className={`break-words ${log.type === 'error' ? 'text-red-400' :
                                            log.type === 'success' ? 'text-emerald-400' :
                                                'text-neutral-300'
                                        }`}>
                                        {log.type === 'error' && <AlertCircle className="w-3 h-3 inline mr-1 -mt-0.5" />}
                                        {log.message}
                                    </div>
                                    {log.details && (
                                        <pre className="mt-2 p-2 bg-neutral-900 rounded text-[10px] overflow-x-auto text-neutral-400 border border-neutral-800">
                                            {JSON.stringify(log.details, null, 2)}
                                        </pre>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}