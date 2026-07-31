# Voice input

Voice input records a short message, transcribes it with Gemini, and inserts the result into the
chat composer. It does not send the message automatically, so you can review or edit the text
first.

Voice input is available in the web and desktop clients. Native iOS and Android support is not yet
included.

## Set up Gemini

1. Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/app/apikey).
2. In Coda, open **Settings → General → Voice input**.
3. Paste the key into **Gemini API key**, then leave the field or press Enter to save it.

The key is stored only in that client. A different browser, device, or desktop installation needs
its own setting. Browser local storage and the desktop client settings file are not secure vaults,
so use a restricted key intended for transcription rather than a broadly privileged credential.

Recordings go directly from the client to the Gemini API. They do not pass through the Coda server,
including when the chat is connected to a remote environment.

## Dictate a message

1. Select the microphone button beside the chat send button.
2. Speak in English, Russian, Ukrainian, or switch between them.
3. Select the red stop button. Recordings stop automatically after two minutes.
4. Wait for the transcript to appear at the current cursor, then edit or send it normally.

The first recording prompts for microphone permission. If recording is unavailable, allow
microphone access for Coda in your browser or operating-system settings and try again.
