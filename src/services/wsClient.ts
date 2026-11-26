type WsMessageHandler = (msg: Record<string, unknown>) => void;

class MultiplayerSocketClient {
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private tokenProvider: (() => Promise<string | null>) | null = null;
  private authenticated = false;
  private outbox: string[] = [];
  private listeners = new Set<WsMessageHandler>();
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private statusListeners = new Set<(status: 'connected' | 'connecting' | 'disconnected') => void>();
  private status: 'connected' | 'connecting' | 'disconnected' = 'disconnected';
  private pendingReconnectMatch: { matchId: string; reconnectToken: string } | null = null;

  connect(token: string, tokenProvider?: () => Promise<string | null>): void {
    this.token = token;
    if (tokenProvider) {
      this.tokenProvider = tokenProvider;
    }

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      if (this.ws.readyState === WebSocket.OPEN && !this.authenticated) {
        this.ws.send(JSON.stringify({ type: 'auth', token }));
      }
      return;
    }

    this.authenticated = false;
    this.setStatus('connecting');
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      if (this.token && this.ws === ws) {
        ws.send(JSON.stringify({ type: 'auth', token: this.token }));
      }
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
        if (msg.type === 'auth:ok') {
          this.authenticated = true;
          this.setStatus('connected');
          this.startHeartbeat();
          if (this.pendingReconnectMatch) {
            ws.send(
              JSON.stringify({
                type: 'match:reconnect',
                matchId: this.pendingReconnectMatch.matchId,
                reconnectToken: this.pendingReconnectMatch.reconnectToken,
              }),
            );
          }
          this.flushOutbox();
        } else if (msg.type === 'auth:error') {
          this.authenticated = false;
          this.setStatus('disconnected');
        }
        for (const cb of this.listeners) {
          cb(msg);
        }
      } catch {
        // Ignore malformed packets
      }
    };

    ws.onclose = () => {
      if (this.ws === ws) {
        this.ws = null;
      }
      this.authenticated = false;
      this.stopHeartbeat();
      this.setStatus('disconnected');
      if (this.token && this.reconnectTimer === null) {
        this.reconnectTimer = window.setTimeout(async () => {
          this.reconnectTimer = null;
          if (!this.token) return;
          if (this.tokenProvider) {
            try {
              const fresh = await this.tokenProvider();
              if (fresh) this.token = fresh;
            } catch {
              // Keep existing token fallback
            }
          }
          if (this.token) this.connect(this.token);
        }, 1800);
      }
    };

    ws.onerror = () => {
      // Handled by onclose
    };
  }

  disconnect(): void {
    this.token = null;
    this.tokenProvider = null;
    this.authenticated = false;
    this.outbox = [];
    this.pendingReconnectMatch = null;
    this.stopHeartbeat();
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setStatus('disconnected');
  }

  setActiveReconnectInfo(info: { matchId: string; reconnectToken: string } | null): void {
    this.pendingReconnectMatch = info;
  }

  isAuthenticated(): boolean {
    return this.authenticated && this.ws?.readyState === WebSocket.OPEN;
  }

  send(payload: Record<string, unknown> | object): boolean {
    const raw = JSON.stringify(payload);
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.authenticated) {
      this.ws.send(raw);
      return true;
    }

    // Queue message if session has a token (connecting or authenticating)
    if (this.token) {
      const msgType = (payload as { type?: unknown }).type;
      if (msgType === 'match:aim') {
        this.outbox = this.outbox.filter((item) => !item.includes('"type":"match:aim"'));
      }
      if (this.outbox.length < 24) {
        this.outbox.push(raw);
      }
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
        this.connect(this.token);
      }
      return true;
    }

    return false;
  }

  subscribe(cb: WsMessageHandler): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  onStatusChange(cb: (status: 'connected' | 'connecting' | 'disconnected') => void): () => void {
    this.statusListeners.add(cb);
    cb(this.status);
    return () => this.statusListeners.delete(cb);
  }

  private flushOutbox(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.authenticated) return;
    const pending = this.outbox.splice(0, this.outbox.length);
    for (const raw of pending) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(raw);
      }
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN && this.authenticated) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 25000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private setStatus(s: 'connected' | 'connecting' | 'disconnected'): void {
    this.status = s;
    for (const cb of this.statusListeners) {
      cb(s);
    }
  }
}

export const wsClient = new MultiplayerSocketClient();
