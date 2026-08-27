# Organizing threads

Pin a thread from its context menu to keep it in the pinned section above your active work.
Pinned threads are shown independently of their project, including when you connect to more than
one environment.

On web and desktop, drag a pinned thread to change its position. On mobile, open the thread's menu
and choose **Move up** or **Move down**. The order is stored by the server and appears on your
other connected devices.

If reordering is unavailable for one environment, update the Coda server running in that
environment. Older servers can still pin and unpin threads, but do not understand synced ordering;
their pinned threads keep the default newest-first order below the ones you have arranged.

## Distinguishing done work from work that needs input

Turn completion analysis is an optional setting that checks the agent's final response after a
successful turn. When the agent says that required work is still blocked on a clarification,
decision, approval, or other user input, the thread shows **Needs Input** instead of looking done.

Enable it from **Settings → General → Turn completion analysis**. By default, analysis uses the
global text generation model. Turn on **Completion analysis model** to choose a separate provider
and model for this task.

The analysis classifies what the agent reports in its response. It does not inspect the code to
independently prove that an implementation is correct.
