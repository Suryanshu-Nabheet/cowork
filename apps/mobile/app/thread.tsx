import { ChatMarkdown } from "@cowork/chat-ui/native";
import { Link, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { NativeSymbol } from "../components/native-symbol";
import {
  applyMobileThreadEvent,
  blockText,
  type MobileMessage,
  type MobileSnapshot,
  rpc,
  subscribeThread,
} from "../lib/api";

export default function Thread() {
  const navigation = useNavigation();
  const router = useRouter();
  const { botId, name } = useLocalSearchParams<{ botId?: string; name?: string }>();
  const scroll = useRef<ScrollView>(null);
  const [snap, setSnap] = useState<MobileSnapshot | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    navigation.setOptions({ title: name || "Thread" });
  }, [name, navigation]);

  async function refresh() {
    if (!botId) return;
    const next = await rpc<MobileSnapshot>("threads/get", { botId });
    setSnap(next);
    return next;
  }

  useEffect(() => {
    if (!botId) return;
    const abort = new AbortController();
    let fallback: ReturnType<typeof setInterval> | undefined;
    void (async () => {
      const next = await refresh().catch((err: Error) => {
        setError(err.message);
        return null;
      });
      if (abort.signal.aborted) return;
      fallback = setInterval(() => void refresh().catch(() => undefined), 2500);
      try {
        await subscribeThread(
          botId,
          next?.cursor ?? -1,
          (event) => {
            if (
              event.type === "thread.progress" ||
              event.type === "thread.message.created" ||
              event.type === "thread.subagent" ||
              event.type === "thread.tool" ||
              event.type === "run.completed" ||
              event.type === "run.failed" ||
              event.type === "run.cancelled"
            ) {
              setSnap((prev) => applyMobileThreadEvent(prev, event));
            }
            if (
              event.type === "thread.message.created" ||
              event.type === "run.completed" ||
              event.type === "run.failed" ||
              event.type === "run.cancelled"
            ) {
              void refresh().catch(() => undefined);
            }
          },
          abort.signal,
        );
      } catch {
        // Keep polling; live subscribe is best-effort on device.
      }
    })();
    return () => {
      abort.abort();
      if (fallback) clearInterval(fallback);
    };
  }, [botId]);

  async function send() {
    if (!botId || !draft.trim()) return;
    const text = draft;
    setDraft("");
    const running = snap?.run && ["running", "queued", "leased"].includes(snap.run.status);
    await rpc(running ? "threads/followUp" : "threads/send", { botId, text });
    await refresh();
  }

  async function stop() {
    if (!botId) return;
    await rpc("threads/stop", { botId });
    await refresh();
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#000", paddingHorizontal: 20, paddingBottom: 24 }}>
      {error ? <Text style={{ color: "#8E8E93", marginTop: 12 }}>{error}</Text> : null}
      <ScrollView
        ref={scroll}
        style={{ flex: 1, marginTop: 8 }}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
      >
        {(snap?.messages ?? []).map((message) => (
          <View
            key={message.id}
            style={{
              marginTop: 12,
              width: "100%",
              flexDirection: "row",
              justifyContent: message.role === "user" ? "flex-end" : "flex-start",
            }}
          >
            <MessageBubble
              message={message}
              onOpenBot={(id, botName) =>
                router.push({ pathname: "/thread", params: { botId: id, name: botName } })
              }
              onStopSubagent={
                botId
                  ? (agentId) =>
                      void rpc("threads/stopSubagent", { botId, agentId }).then(() => refresh())
                  : undefined
              }
            />
          </View>
        ))}
      </ScrollView>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 16 }}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Message…"
          placeholderTextColor="#6C6C70"
          keyboardAppearance="dark"
          returnKeyType="send"
          onSubmitEditing={() => void send()}
          style={{
            flex: 1,
            color: "#ECECEE",
            backgroundColor: "#131315",
            borderRadius: 20,
            paddingHorizontal: 14,
            height: 44,
          }}
        />
        <Pressable
          onPress={() => void send()}
          style={{
            backgroundColor: "#F1F1EF",
            borderRadius: 22,
            width: 44,
            height: 44,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <NativeSymbol ios="arrow.up" android="arrow-up" size={18} color="#17171A" />
        </Pressable>
        {snap?.run && ["running", "queued", "leased"].includes(snap.run.status) ? (
          <Pressable
            onPress={() => void stop()}
            style={{
              backgroundColor: "#2A2A2F",
              borderRadius: 22,
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <NativeSymbol ios="stop.fill" android="stop" size={16} color="#F1F1EF" />
          </Pressable>
        ) : null}
      </View>
      <Link
        href={{ pathname: "/computer", params: { botId: botId ?? "", name: name ?? "Bot" } }}
        asChild
      >
        <Pressable style={{ marginTop: 16 }}>
          <Text style={{ color: "#C9C9CE" }}>Open computer →</Text>
        </Pressable>
      </Link>
    </View>
  );
}

function MessageBubble({
  message,
  onOpenBot,
  onStopSubagent,
}: {
  message: MobileMessage;
  onOpenBot: (botId: string, name: string) => void;
  onStopSubagent?: (agentId: string) => void;
}) {
  const special = message.blocks.find(
    (block) => block.kind === "subagent" || block.kind === "child_bot",
  );
  if (special?.kind === "subagent") {
    const running = special.status === "running";
    const failed = special.status === "failed";
    return (
      <View
        style={{
          width: "90%",
          borderRadius: 18,
          borderWidth: 1,
          borderColor: "#232326",
          backgroundColor: "#17171A",
          paddingHorizontal: 16,
          paddingVertical: 14,
        }}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
          <Text style={{ color: "#ECECEE", fontSize: 15, fontWeight: "600" }}>
            {special.name || "subagent"}
          </Text>
          <Text
            style={{ color: failed ? "#E65707" : running ? "#F5A03C" : "#4ECB71", fontSize: 13 }}
          >
            {running ? "subagent" : special.status}
          </Text>
        </View>
        {special.task ? (
          <Text style={{ color: "#85858A", marginTop: 8, fontSize: 13.5 }}>{special.task}</Text>
        ) : null}
        {running && onStopSubagent && special.agentId ? (
          <Pressable
            onPress={() => onStopSubagent(special.agentId!)}
            style={{
              marginTop: 10,
              alignSelf: "flex-start",
              borderRadius: 12,
              borderWidth: 1,
              borderColor: "#3A3A40",
              paddingHorizontal: 10,
              paddingVertical: 6,
            }}
          >
            <Text style={{ color: "#ECECEE", fontSize: 12 }}>Stop subagent</Text>
          </Pressable>
        ) : null}
        {special.result || special.progress ? (
          <View style={{ marginTop: 8 }}>
            <ChatMarkdown streaming={running}>
              {special.result || special.progress || ""}
            </ChatMarkdown>
          </View>
        ) : null}
      </View>
    );
  }
  if (special?.kind === "child_bot") {
    const deleted = special.status === "deleted";
    return (
      <Pressable
        disabled={deleted}
        onPress={() => onOpenBot(special.botId ?? "", special.name ?? "Bot")}
        style={{
          width: "90%",
          borderRadius: 18,
          borderWidth: 1,
          borderColor: "#232326",
          backgroundColor: "#17171A",
          paddingHorizontal: 16,
          paddingVertical: 14,
          opacity: deleted ? 0.6 : 1,
        }}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
          <Text style={{ color: "#ECECEE", fontSize: 15, fontWeight: "600" }}>
            {special.name || "Bot"}
          </Text>
          <Text style={{ color: deleted ? "#E65707" : "#4ECB71", fontSize: 13 }}>
            {deleted ? "deleted" : "bot"}
          </Text>
        </View>
        <Text style={{ color: "#A8A8AD", marginTop: 8, fontSize: 14.5, lineHeight: 21 }}>
          {deleted
            ? "Removed this bot, including its chat, computer, and memory."
            : special.title || "Opened its own thread. Tap to switch."}
        </Text>
      </Pressable>
    );
  }
  return (
    <View
      style={{
        flexShrink: 1,
        minWidth: 0,
        maxWidth: "85%",
        backgroundColor: message.role === "user" ? "#F1F1EF" : "#1A1A1D",
        padding: 12,
        borderRadius: 20,
      }}
    >
      {message.role === "user" ? (
        <Text style={{ color: "#1A1A1A", fontSize: 15.5, lineHeight: 23 }}>
          {blockText(message)}
        </Text>
      ) : (
        <ChatMarkdown streaming={message.id.startsWith("progress:")}>
          {blockText(message)}
        </ChatMarkdown>
      )}
    </View>
  );
}
