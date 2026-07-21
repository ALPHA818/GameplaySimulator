import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes
} from 'react';
import { createPortal } from 'react-dom';

type FieldHelpText = string;

type FieldLabelProps = {
  label: string;
  helpText?: FieldHelpText;
  htmlFor?: string;
  className?: string;
};

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  helpText?: FieldHelpText;
};

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  error?: string;
  helpText?: FieldHelpText;
  children: ReactNode;
};

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  error?: string;
  helpText?: FieldHelpText;
};

type ToggleProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  helpText?: FieldHelpText;
};

type TooltipPlacement = 'bottom' | 'top' | 'right' | 'left';

type TooltipRect = Pick<DOMRect, 'bottom' | 'height' | 'left' | 'right' | 'top' | 'width'>;

type TooltipSize = {
  width: number;
  height: number;
};

type TooltipViewport = {
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
};

export type TooltipPosition = {
  left: number;
  top: number;
  maxWidth: number;
  maxHeight: number;
  placement: TooltipPlacement;
};

const TOOLTIP_GAP = 8;
const TOOLTIP_MARGIN = 12;
const TOOLTIP_DEFAULT_WIDTH = 320;
const TOOLTIP_DEFAULT_HEIGHT = 140;
const TOOLTIP_MAX_WIDTH = 360;
const TOOLTIP_MAX_HEIGHT_RATIO = 0.45;
const TOOLTIP_LAYER_Z_INDEX = 2_147_483_000;

const fieldHelpText: Record<string, string> = {
  'Action Delay Ms':
    'This is the wait time between bot actions, measured in milliseconds. The simulator uses it so bots do not press controls too fast. For example, 250 means a quarter of a second. If this is too low, a game may miss inputs or act strangely. Beginners should use 250.',
  'Action Decision':
    'This explains why a bot chose one action. The simulator uses profile rules, game state, coverage, and seeded randomness to make the explanation. For example, an Explorer may move forward because the action is unvisited. If the explanation looks wrong, check the bot profile and available actions. Beginners should read this before the raw JSON.',
  'Action Quality':
    'This labels the kind of choice the bot made. Planned follows normal rules, exploratory tries something new, recovery escapes a stuck state, repeated retries an action, risky tests an edge case, random is chaos behavior, and startup-flow follows menu setup. If the label surprises you, read the action reason. Beginners do not need to change it.',
  'Action Reason':
    'This is the plain-language reason a bot chose its current action. The simulator creates it from planner rules and game context. For example, a UI Tester may open a menu because it matches UI rules. If it seems wrong, check the selected bot profile. Beginners can use it to understand what the bot is doing.',
  'Action Timeline':
    'This saves the list of actions each bot tried. The simulator uses it to show what happened before an issue. For example, move, jump, then interact. If this is off, reports have fewer steps. Beginners should leave it on.',
  'Action Endpoint':
    'This is the server route where the simulator asks an instrumented game to perform an action. It is used when bots choose moves like jump, open menu, or buy item. For example, /gsi/v1/actions. If this route is wrong, actions will not reach the game. Beginners should use the default route from the SDK.',
  'Adapter Type':
    'This tells the simulator how to talk to your game. It is used to choose the right adapter for launching, reading, and controlling the game. For example, use Desktop for a normal installed game, or Instrumented when your game exposes test data. If this is wrong, bots may not control the game. Beginners should choose Desktop unless they know their game has instrumentation.',
  'Adapter Limitations':
    'This lists things the selected setup may not be able to do. The simulator uses it to warn you before bots start. For example, desktop fallback may launch a game but read less game state. If you ignore this, reports may have less detail. Beginners should fix warnings before long runs.',
  'Adapter Runtime':
    'This shows which runtime path the simulator used during the test. It helps you see if the app used browser, instrumented, desktop fallback, or custom mode. For example, engine-desktop-fallback means a Unity, Godot, or Unreal game is being controlled like a normal window. If this is unexpected, choose a different wizard. Beginners should use the runtime the wizard recommends.',
  'Add Bot Type':
    'This chooses another kind of bot to add to the session. The simulator uses it to create a new bot pool. For example, add Explorer Bot to test maps. If there are no choices, all bot types are already added. Beginners should start with Explorer Bot.',
  'Auto Scaling':
    'This lets the simulator lower or raise bot counts based on your computer. It is used to avoid overloading the PC. For example, it may run 6 bots instead of 10 if memory is tight. If this is off, fixed counts are used even when they are heavy. Beginners should leave it on.',
  'Available Actions':
    'This is the list of actions the game says a bot can try right now. The simulator uses it to choose what to do next. For example, move-forward, open-menu, or buy-item. If the list is empty or wrong, bots may stop or make poor choices. Beginners should check this after the health check works.',
  'Available Actions Preview':
    'This shows actions the adapter found during the profile test. The simulator uses these actions when bots begin testing. For example, Jump, Interact, or Reload Page may appear. If the list is empty, bots may have little to do. Beginners should add controls or instrumentation until at least one useful action appears.',
  Bot:
    'This filters the list by one bot. It is used when you only want to see what one bot found. For example, choose explorer-001. If you pick the wrong bot, you may hide the item you wanted. Beginners can leave this on All bots.',
  Build:
    'This is the exact build name or build number for your game. The simulator uses it in reports so you know which version was tested. For example, demo-build-42. If it is wrong, reports may point to the wrong build. Beginners can leave it blank if they do not have a build number.',
  'Build/version':
    'This shows the game version and build for the running session. The simulator uses it in reports so you know exactly what was tested. For example, 1.0.0 / build-42. If it is wrong, you may chase a bug in the wrong build. Beginners should check that it matches the game they opened.',
  Bots:
    'This shows how many bots were requested for a session or report. The simulator uses it to summarize test size. For example, 6 means six bot slots were planned. If it looks wrong, the session may not match what you meant to test. Beginners should start with a small number.',
  Category:
    'This filters issues by the kind of problem. It is used to focus on one problem type. For example, choose crash or quest. If you pick the wrong category, some issues will be hidden. Beginners can leave this on All categories.',
  'CPU Percent':
    'This is the highest CPU use you want the simulator to aim for. CPU is your computer brain doing work. For example, 80 means leave some room for the system. If this is too high, the computer may slow down. Beginners should use 80.',
  'Current Action':
    'This is the action the bot most recently chose and is working on. The simulator sends it through the selected game adapter. For example, open-menu or move-forward. If it does nothing, check the last result and control mapping. Beginners should watch this change during a run.',
  'Current Bot Goal':
    'This is what the selected bot is trying to achieve. The simulator gets it from the bot profile. For example, a UI Tester may try to exercise menus. If it does not match your test, choose a different bot profile. Beginners should confirm the goal before a long run.',
  'Desired':
    'This is the bot count you want most. The simulator tries to run this many bots if it can. For example, desired 8 means try to run 8 bots. If it is too high, auto scaling may recommend fewer bots. Beginners should start with 2 or 3.',
  'Direct Actions':
    'This says the adapter can send game actions directly, not just keyboard or mouse input. The simulator uses it for more exact testing. For example, a game test API may accept jump or open_inventory. If this is wrong, actions may fail. Beginners should turn this on only for instrumented builds.',
  'Direct State Read':
    'This says the simulator can read real game state, like scene, quest, and player data. It is used for smarter bots and better issue reports. For example, the game can tell the simulator the player is in Level 1. If this is wrong, reports may be confusing. Beginners should turn this on only when the game exposes state.',
  'DOM Scan Mode':
    'This controls whether the browser adapter reads visible page parts such as buttons, headings, menus, dialogs, text, and a game canvas. The simulator uses these clues when your game does not provide a UI hook. For example, Fallback can notice a Play Game button on the main menu. Always also merges DOM clues with hook data, while Off reads no DOM clues. A wrong choice can hide useful menu clues or add a little extra work each bot step. Beginners should use Fallback when UI hooks are missing.',
  'DOM UI Clues':
    'This shows when the browser adapter reads visible page parts as clues. The simulator can use buttons, headings, dialogs, text, and canvas presence to tell menus from gameplay. For example, fallback scans only when a UI hook gives no useful details. If this is off for an uninstrumented game, menu bots may understand less. Beginners should use fallback.',
  'Disk usage warning':
    'This warns you when screenshot or video settings may create many files. The simulator uses it to help protect your disk space. For example, taking a screenshot every 2 actions with many bots can make hundreds of images. If you ignore it, the run may use more storage than expected. Beginners should use screenshots every 20 or 50 actions.',
  'Control Mappings':
    'This tells the simulator which keys or buttons match game actions. The desktop fallback uses it to press controls for bots. For example, move up = W, interact = E, and jump = Space. If this is empty for a desktop game, bots cannot control the game. Beginners should add the same controls they use when playing.',
  'Capture Console Errors':
    'This records error and warning messages printed by the browser game. The simulator uses them to explain bugs and crashes. For example, a JavaScript error can appear here. If this is missing, reports may have less detail. Beginners should leave this on.',
  'Console Error Capture Preview':
    'This shows browser errors and warnings captured during the page test. The simulator uses these messages as clues in bug reports. For example, a JavaScript error may explain why a menu broke. If this stays empty, that can be good, or it may mean the page did not run far enough. Beginners should use it after the page launch test.',
  'Capture Page Errors':
    'This records serious page errors from the browser. The simulator uses them to detect broken scripts or crashes. For example, an uncaught JavaScript exception can be captured. If this is missing, browser bugs may be harder to understand. Beginners should leave this on.',
  'Compare Sessions':
    'This compares two saved test runs. The simulator uses it to find new issues, fixed issues, repeated issues, coverage changes, and performance changes. For example, compare build 1.0.1 with build 1.0.2. If the sessions are chosen backwards, the report may be confusing. Beginners should pick the older run first and the newer run second.',
  'Cleanup Options':
    'These settings remove or preserve files inside one saved run bundle. The simulator uses them to save disk space after many tests. For example, you can delete raw state logs but keep summaries and screenshots. If you delete too much, deep debugging may be harder. Beginners should keep screenshots and summaries on.',
  'Cleanup Session':
    'This is the saved run you want to clean up. The simulator changes files only inside this session bundle. For example, choose yesterday’s stress test before deleting noisy state logs. If you choose the wrong session, you may clean the wrong run. Beginners should archive first.',
  'Delete old raw state logs':
    'This deletes large bot state snapshot files from a saved run. The simulator keeps summaries and important events so the run is still readable. For example, use this after a long stress test with many state snapshots. If you delete them, raw state debugging is harder. Beginners should use it only after reading the report.',
  'Coverage Percentage':
    'This shows how much known game content was tested in a session. The simulator uses your game profile and observed content to calculate it. For example, 40% means four out of ten known items were reached. If the profile content list is incomplete, this number may be misleading. Beginners should use it as a guide, not a perfect score.',
  'Desktop Input Driver':
    'This shows whether the simulator can send keyboard or mouse input to desktop games. Bots use it to control the game like a player. For example, Linux uses xdotool. If it is missing, bots may launch the game but cannot press buttons. Beginners on Linux should install xdotool.',
  'Custom Test Method':
    'This chooses how a custom engine should be tested. The simulator can use an instrumented endpoint, desktop fallback, or a custom adapter placeholder. For example, choose Instrumented endpoint if your engine can expose game state over HTTP. If this is wrong, the test may not control the game. Beginners should choose Instrumented when possible, then Desktop fallback.',
  'Engine Type':
    'This is the game engine or game kind. The simulator uses it to suggest the right adapter. For example, Unity, Godot, Unreal, Browser, or Custom. If it is wrong, setup hints may be less useful. Beginners can choose Unknown if they are not sure.',
  'Engine Test Mode':
    'This chooses the best way to test an engine game. Instrumented SDK means the game shares state directly. Desktop fallback means the simulator opens the game window and presses controls. For example, use Instrumented SDK for a debug build with the SDK installed. If this is wrong, bots may have weak awareness or fail to connect. Beginners should choose Instrumented if available.',
  'Engine Version':
    'This is the version of the engine used by the game. The simulator puts it in reports and adapter notes. For example, Unity 2022.3. If it is wrong, debugging may be harder. Beginners can leave it blank.',
  'Event Type':
    'This filters logs by what happened. It is used to find one kind of event quickly. For example, action_performed or issue_detected. If you choose the wrong event, other logs will be hidden. Beginners can leave this on All event types.',
  'Event Endpoint':
    'This is the server route where an instrumented game can send events to the simulator. It is used for warnings, errors, quest updates, inventory updates, and coverage events. For example, /gsi/v1/events. If this route is wrong, the simulator may miss useful game messages. Beginners should use the default route from the SDK.',
  'Executable Path':
    'This is the file that starts your game. The simulator uses it to open the game before bots begin testing. For example, MyGame.exe on Windows or ./MyGame.x86_64 on Linux. If this path is wrong, the simulator cannot start the game. Choose the same file you normally double-click to open your game.',
  Adapter:
    'This shows which adapter the game profile uses. The simulator uses the adapter to launch, watch, and control the game. For example, Desktop is for a normal game window. If this is wrong, bots may not be able to play. Beginners should use Desktop unless their game has instrumentation.',
  Engine:
    'This shows the game engine or game kind. The simulator uses it to choose helpful adapter settings and report details. For example, Unity, Godot, Unreal, Browser, or Custom. If it is wrong, setup hints may be less useful. Beginners can use Unknown when they are not sure.',
  Evidence:
    'This shows what proof the adapter can save, like screenshots or video. The simulator uses evidence to explain bugs in reports. For example, a screenshot can show a stuck screen. If evidence is missing, issues may be harder to check later. Beginners should use screenshots when possible.',
  'Evidence path':
    'This is where an evidence file is saved on your computer. The simulator uses it to open screenshots or videos from a report. For example, it may point to runs/session/bots/explorer-001/screenshots/issue.png. If the path is missing or moved, the app cannot open the evidence. Beginners should leave files inside the runs folder.',
  'Fallback evidence':
    'This means the simulator could not get a real screenshot, so it saved a simple debug picture instead. The simulator uses it so the issue still has some proof and context. For example, this can happen if a screenshot tool is missing. If you see this often, check adapter screenshot support. Beginners can still review the issue, but real screenshots are better.',
  Game:
    'This is the game profile in the list. The simulator uses it to pick the game name and version for a test session. For example, Sample Browser Game version 0.1. If you choose the wrong game, bots may test the wrong build. Beginners should pick the profile they created for their game.',
  'Game Name':
    'This is the friendly name of your game. The simulator uses it in lists and reports. For example, Space Farm Adventure. If it is wrong, reports may be hard to match to the game. Beginners should use the normal game title.',
  'Game Profile':
    'This chooses which game setup to test. The simulator uses it to know how to launch and control the game. For example, choose Sample Browser Game. If this is wrong, bots may test the wrong game. Beginners should choose the profile they just created.',
  'Game URL':
    'This is the web address of the browser game. The simulator opens this page before the bots start testing. For example, http://localhost:5173 or https://mygame.example.com. If this is wrong, the simulator will open the wrong page or fail to start. Beginners should paste the same address they use in their browser.',
  'Game/Engine/Build':
    'This shows what game, engine, and build the profile test found. The simulator uses it to make sure you are testing the right thing. For example, it may show MyGame, Unity, build 42. If it looks wrong, the profile may point at the wrong game or endpoint. Beginners should check this before starting bots.',
  'Game State Endpoint':
    'This is the server route where the simulator asks what is happening in the game. It is used by instrumented games to send scene, player, quest, inventory, UI, and performance data. For example, /gsi/v1/state. If this route is wrong, bots cannot understand the game. Beginners should use the default route from the SDK.',
  'Game instances':
    'This shows how many game copies the session plans to open. The simulator uses this to place bots in running games. For example, 2 means two game windows or endpoints. If it is too high, your computer or save files may have trouble. Beginners should use 1 unless they know multiple copies are safe.',
  'Global Bot Limit':
    'This is the most bots the whole session may run. The simulator uses it as a hard safety limit. For example, 10 means never run more than 10 bots. If it is too high, your computer may slow down. Beginners should start with 4.',
  'GPU Percent':
    'This is the highest graphics-card use you want the simulator to aim for. The GPU helps draw the game. For example, 80 means leave some room. If this is too high, the game may stutter. Beginners can use 80 or leave it unchanged.',
  'Estimated CPU':
    'This is the computer work the simulator thinks the run will use. CPU is your computer brain. For example, 55% means more than half of the CPU may be busy. If this is too high, the game may stutter. Beginners should keep it below the limit they chose.',
  'Estimated RAM':
    'This is the memory the simulator thinks the run will use. RAM is short-term computer memory. For example, 1800 MB means about 1.8 GB. If this is too high, the computer may slow down or freeze. Beginners should lower bot counts when this looks large.',
  'Final bots':
    'This is the number of bots the simulator will actually create after checking limits. It uses bot pool settings and resource estimates. For example, you may ask for 10 but get 6. If it is lower than expected, read the recommendation reason. Beginners should trust the final number for safer runs.',
  Heartbeat:
    'This is the last time the simulator heard from a game instance. It is used to notice frozen or unresponsive game copies. For example, a recent time means the instance was checked recently. If it stops changing, the instance may be stuck. Beginners should look for recent times while a session is running.',
  'Health Check':
    'This is the server route that says whether an instrumented game is ready. The simulator uses it before testing so it knows the game bridge is alive. For example, /gsi/v1/health. If it fails, the simulator may not be able to talk to the game. Beginners should check this first when an instrumented profile does not connect.',
  Issues:
    'This chooses which issues to export or review. The simulator uses it to build the preview and markdown files. For example, select one crash and one softlock. If you choose the wrong issues, the export will contain the wrong reports. Beginners can use Select Eligible.',
  'Issue Count':
    'This shows how many issues were saved in a session. The simulator uses it to help you choose which old run to review. For example, 3 means three detected problems. If it seems wrong, reload sessions so the app rereads the runs folder. Beginners should open sessions with critical or error issues first.',
  'Issues found':
    'This shows how many problems the simulator detected. It is used to summarize crashes, stuck states, UI problems, and possible exploits. For example, 2 means two issues were found. If it is high, open the Issues page. Beginners should review critical issues first.',
  Instance:
    'This filters by one game copy. The simulator uses it to show logs from that instance only. For example, choose game-instance-001. If you pick the wrong instance, other logs will be hidden. Beginners can leave this on All instances.',
  Instances:
    'This shows whether the game profile can open one game copy or many. The simulator uses it to decide if bots can run in parallel. For example, Multiple means more than one game window may be allowed. If this is wrong, bots may fight over saves or windows. Beginners should choose Single unless they know multiple copies are safe.',
  'Assigned bots':
    'These are the bots using this game instance. The simulator uses this to show which bots belong to each running game copy. For example, explorer-001 and explorer-002 may share one browser instance. If this looks wrong, bots may be assigned to the wrong game copy. Beginners should check that important bots are listed here before starting a long run.',
  'CPU/RAM':
    'This shows the estimated computer work and memory used by the game instance. The simulator uses it to help spot heavy or stuck game copies. For example, 20% / 900 MB means some CPU use and 900 MB of RAM. If the values are very high, your computer may slow down. Beginners should stop the run if the PC feels overloaded.',
  'Game instance status':
    'This shows whether this game copy is starting, running, stopped, crashed, unresponsive, or failed. The simulator uses it to decide whether bots can safely run there. For example, running means bots can test, while crashed means the game copy stopped unexpectedly. If this is unhealthy, bots may fail too. Beginners should look for running or stopped.',
  'Instance health check':
    'This shows whether the adapter thinks the game instance is healthy. The simulator checks the process and adapter health in the background. For example, Healthy means no crash or unresponsive state was reported. If this says crashed, failed, or unresponsive, the run may need attention. Beginners should stop and inspect logs when this is not Healthy.',
  'Instance ID':
    'This is the name of one running game copy. The simulator uses it to connect bots, logs, screenshots, and reports to the right instance. For example, game-instance-001. If it is mixed up, evidence may point to the wrong game copy. Beginners only need to use it when reading logs or reports.',
  'Instance planning':
    'This explains how the simulator plans to place bots into game instances. It is used to warn about queues, limits, or shared saves before launch. For example, it may say extra bots are queued or saves are shared. If you ignore it, the run may be slower or unsafe for save files. Beginners should fix warnings before long tests.',
  'Instrumentation Endpoint':
    'This is the local address where your game shares test data with the simulator. The instrumented adapter uses it to read game state and send direct actions. For example, http://127.0.0.1:4555. If this is wrong, the simulator cannot connect to the game. Beginners can leave it blank unless their game has the instrumentation SDK.',
  'Input Support Check':
    'This checks whether the current computer can send controls to a desktop game. The simulator uses it before bots press keys or mouse buttons. For example, Linux needs xdotool for input. If this is missing, the game may open but bots cannot play it. Beginners should fix input support before desktop bot runs.',
  'Focus Window':
    'This shows whether the simulator can bring the game window to the front. Bots use it before sending controls so input goes to the game. For example, Linux uses xdotool and macOS uses osascript. If this fails, the bot will not send input to the wrong window. Beginners should fix focus before running desktop bots.',
  'Keyboard Input':
    'This shows whether the simulator can press keyboard keys for desktop games. Bots use it for actions like move, jump, and menu. For example, Jump might press Space. If this is unavailable, keyboard controls will be skipped or fail. Beginners should use Linux with xdotool for now.',
  'Launch Arguments':
    'These are extra words sent when the game starts. The simulator passes them to the game launcher. For example, --debug or -windowed. If they are wrong, the game may not start or may use the wrong mode. Beginners should leave this blank unless the game needs special launch options.',
  Max:
    'This is the most bots this pool may ever create. The simulator will not go above this number. For example, max 20 means no more than 20 explorer bots. If it is too high, the PC may be overloaded. Beginners should keep it modest, like 5.',
  'Max Actions Per Bot':
    'This stops each bot after a set number of actions. The simulator uses it for short test runs. For example, 100 means each bot stops after 100 actions. If it is too low, bots may not test much. Beginners can leave it blank or use 100.',
  'Max Game Instances':
    'This is the most copies of the game the simulator may open. It is used when bots need separate game windows. For example, 2 means at most two game copies. If it is too high, the PC may slow down or saves may conflict. Beginners should use 1 or 2.',
  'Max Runtime Minutes':
    'This is how long the session may run before it stops. The simulator uses it as a time limit. For example, 30 means stop after 30 minutes. If it is too short, bots may not reach much content. Beginners can use 15 or 30.',
  'Next Likely Action':
    'This is the action the planner currently thinks may be a good next choice. It is only a guess because game state can change after every action. For example, close-menu may follow open-menu. If it is missing, the planner does not know yet. Beginners can use it to spot surprising plans.',
  'Min':
    'This is the smallest number of bots this pool should try to run. The simulator uses it to protect important bot types. For example, min 1 means run at least one explorer if possible. If it is too high, the session may not fit your PC. Beginners should use 0 or 1.',
  'Minimum Confidence':
    'This is how sure the simulator must be before exporting an issue. Confidence means how likely the issue is real. For example, 80 means export issues that are at least 80 percent sure. If it is too high, you may miss useful reports. Beginners should use 80.',
  'Minimum Severity':
    'This chooses the lowest issue level to export. The simulator uses it to skip small problems. For example, choose error to export errors and critical issues. If it is too high, warnings will be skipped. Beginners should use warning.',
  'Missing Fields':
    'This lists setup items that still need attention. The simulator uses it to explain what is missing before a safe test can start. For example, it may ask for a game URL or an executable path. If you ignore it, launch or bot control may fail. Beginners should clear this list before running bots.',
  'Last action':
    'This is the most recent action a bot tried. The simulator uses it to explain what happened right before a status or issue. For example, jump or open-menu. If it looks wrong, the bot may be following the wrong plan. Beginners can use it to understand what the bot is doing.',
  'Last Result':
    'This shows what happened after the bot action. It can say succeeded, failed, skipped, or timed out, followed by a short message. For example, succeeded: menu opened. If actions keep failing, check adapter health and controls. Beginners should fix repeated failures before adding bots.',
  'Known tested':
    'This shows how much known content was tested. The simulator compares your game profile content list with what bots reached. For example, 5/10 means five known items were tested. If the list is wrong, this number may mislead you. Beginners should add important scenes and quests first.',
  Message:
    'This is the latest short note from the runtime. The simulator uses it to explain a bot or instance status. For example, Running, Paused, or No available actions. If it shows an error, check logs and reports. Beginners should read this when something looks stuck.',
  Mode:
    'This shows how the session runs bots. The simulator uses it to decide whether bots run together or one after another. For example, parallel runs many at once, and sequential runs one at a time. If it is wrong, the run may be too heavy or too slow. Beginners should choose Hybrid for normal testing.',
  'Multiple Instances':
    'This says the game can safely run more than one copy at the same time. The simulator uses it for parallel bot testing. For example, two game windows can run side by side. If this is wrong, save files or windows may conflict. Beginners should turn it off unless they tested it.',
  'Browser Name':
    'This chooses which browser to use when a browser adapter supports that choice. The simulator can use it later to pick Chrome, Edge, Firefox, or another browser. For example, chrome. If this is wrong, the adapter may use a browser you did not expect. Beginners can leave it blank.',
  'Browser Context':
    'This is a private browser space for one game instance. The simulator uses it so each test copy has its own cookies, storage, and page. For example, two instances can open the same game without sharing login state. If this is shared by mistake, bots may affect each other. Beginners should use one context per instance.',
  'Browser Type':
    'This chooses which Playwright browser opens the game. The simulator uses Chromium by default. For example, use chromium for most browser game testing. If this is wrong, the page may behave differently than expected or fail to open. Beginners should use chromium.',
  'Mouse Input':
    'This shows whether the simulator can click mouse buttons for desktop games. Bots use it for actions like attack or select. For example, Attack might use MouseLeft. If this is unavailable, mouse controls will be skipped or fail. Beginners should map keyboard controls when possible.',
  Observed:
    'This shows content the simulator saw during the run, even if it was not listed in the profile. The simulator uses it to learn what bots reached. For example, a new scene name may appear here. If it looks strange, the game state may be noisy. Beginners can use it to improve the profile.',
  'New Session':
    'This chooses the newer test session for comparison. The simulator uses it as the result you want to check. For example, choose the run from build 1.0.2. If this is wrong, the comparison report will be backwards. Beginners should choose the most recent run.',
  Owner:
    'This is the GitHub account or organization name. The simulator uses it only when you choose to post issues. For example, my-studio. If it is wrong, posting will fail. Beginners can leave it blank when only exporting markdown.',
  'Old Session':
    'This chooses the older test session for comparison. The simulator uses it as the baseline. For example, choose the run from build 1.0.1. If this is wrong, new and fixed issues may be reported backwards. Beginners should choose the earlier run.',
  'Open Old Session':
    'This opens a saved test run from the runs folder. The simulator uses it so you can review reports, issues, logs, and evidence after restarting the app. For example, open yesterday’s session to inspect its issues. If you open the wrong one, you may review the wrong build. Beginners should choose the newest finished session unless they are comparing builds.',
  'Open evidence':
    'This opens the selected evidence file, such as a screenshot or video. The simulator uses it so you can check what the bot saw when an issue happened. For example, open a screenshot to confirm a stuck menu. If the file was moved or deleted, opening will fail. Beginners should open evidence before marking an issue reviewed.',
  'Per-Instance Bot Limit':
    'This is the most bots allowed in one game copy. The simulator uses it when an adapter can share one game instance. For example, 2 means at most two bots per game window. If it is too high, bots may interfere with each other. Beginners should use 1 for desktop games.',
  Platform:
    'This is where the game runs. The simulator uses it to understand the launch method. For example, Windows, Linux, macOS, or Browser. If it is wrong, launch settings may not work. Beginners should choose the platform they are using now.',
  Process:
    'This is the operating-system process for a game instance. The simulator uses it to know whether the game copy is alive. For example, pid 1234 means the game is running as process 1234. If it is missing during a run, the game may not have launched. Beginners only need to worry if the status is not running.',
  Profile:
    'This shows which game profile a session used. The simulator uses it to connect reports to the right game setup. For example, sample-browser-game. If it is wrong, you may read results for a different game. Beginners should choose the profile that matches the tested build.',
  'Profile Readiness':
    'This shows whether the profile has the basic fields needed for the selected wizard. The simulator uses it to warn you before a launch test or bot session. For example, Ready to test means the required fields are filled. If items are left, the profile may fail to launch. Beginners should fix the listed items first.',
  'Profile ID':
    'This is a short unique name for the game profile. The simulator uses it to save and find the profile. For example, space-farm-demo. If two profiles use the same ID, they can be mixed up. Beginners should use lowercase words with dashes.',
  'RAM Percent':
    'This is the highest memory use you want the simulator to aim for. RAM is short-term computer memory. For example, 80 means keep some memory free. If this is too high, the computer may freeze or slow down. Beginners should use 80.',
  Repository:
    'This is the GitHub project name. The simulator uses it only when you choose to post issues. For example, gameplay-simulator-test-game. If it is wrong, posting will fail. Beginners can leave it blank when only exporting markdown.',
  Report:
    'This opens the readable report for a session. The simulator uses reports to show results without raw log files. For example, a report can summarize issues, bots, and coverage. If the wrong report is opened, you may review the wrong session. Beginners should open the newest finished session first.',
  'Report Actions':
    'These are actions you can take for a saved session. The simulator uses them to open reports, inspect issues, view logs, compare runs, or export issue markdown. For example, choose View Issues to review bugs from an old run. If you pick the wrong row, you may open the wrong session. Beginners should start with Open Report.',
  'Archive session bundle':
    'This saves a bundle archive manifest before cleanup. The simulator records the files that were in the run so you can see what existed later. For example, archive before deleting raw state logs. If you skip this, cleanup has less history. Beginners should turn this on before cleaning old runs.',
  'Full Logs':
    'This shows every structured log saved for the selected run. The simulator uses it when you need the complete timeline. For example, it includes session logs, bot actions, bot states, issues, and instance logs. If it feels too noisy, use Important Events. Beginners should start with Important Events.',
  'Important Events':
    'This shows the most useful saved events from a run. The simulator separates these from noisy state logs so issues and warnings are easier to find. For example, crashes, recovery attempts, adapter launches, and flow failures appear here. If something is missing, open Full Logs. Beginners should use this first.',
  'Keep screenshots':
    'This keeps screenshot evidence when cleaning a run bundle. The simulator uses screenshots to prove what happened during issues. For example, keep them for crashes, stuck menus, or visual bugs. If you turn this off, reports may lose useful proof. Beginners should leave it on.',
  'Keep summaries':
    'This keeps readable summary files when cleaning a run bundle. The simulator uses summaries so you can understand a run without reading raw JSON. For example, session-summary.md explains bots, issues, and coverage. If you turn this off, the run is harder to inspect. Beginners should leave it on.',
  'Reload Sessions':
    'This makes the app scan the runs folder again. The simulator uses it to find reports created before this app window opened. For example, reload after restarting the app or copying in old runs. If a run folder is broken, it may not appear. Beginners can press this whenever a session is missing.',
  'Recommended bots':
    'This is the number of bots the simulator thinks your computer can handle safely. It uses CPU, RAM, game cost, and adapter limits. For example, it may recommend 4 bots on a laptop. If you ignore it, the game may slow down. Beginners should use the recommended count.',
  'Recommended Integration Docs':
    'This points to the adapter guide that matches your current setup. The simulator shows it so you can connect the game the best way. For example, Unity profiles point to docs/adapters/unity.md. If you read the wrong guide, you may wire the game incorrectly. Beginners should open the recommended guide when a test fails.',
  'Requested bots':
    'This is the number of bots you asked for in all enabled bot pools. The simulator compares it with what your computer can handle. For example, five explorer bots and two combat bots means seven requested bots. If this is too high, some bots may be reduced. Beginners should request a few bots first.',
  'Reserve RAM MB':
    'This is memory the simulator should leave unused for your computer. It is used as a safety cushion. For example, 1024 means leave about 1 GB free. If this is too low, your computer may slow down. Beginners should use 512 or 1024.',
  Runtime:
    'This shows how long the session has been running. The simulator uses it to summarize test length. For example, 05:30 means five minutes and thirty seconds. If it is very short, bots may not have tested much yet. Beginners should let short tests run long enough to visit content.',
  'Running bots':
    'This shows how many bots are active right now. The simulator uses it to show live test activity. For example, 3 running bots means three bots are currently taking actions. If it is zero during a run, something may be paused or stopped. Beginners should expect this to be above zero after starting.',
  'Run anyway':
    'This lets you start even when the simulator shows warnings. It is used only when problems are not fatal. For example, you may run with high CPU if you accept the risk. If you use it carelessly, the PC may slow down. Beginners should leave it off.',
  'Run Mode':
    'This chooses how bots run together. Parallel runs many at once, sequential runs one after another, and hybrid runs a small group. If this is wrong, the test may be too slow or too heavy. Beginners should choose Hybrid.',
  'Run Until Stopped':
    'This keeps the session running until you stop it yourself. The simulator ignores the time limit when this is on. For example, use it for a long overnight test. If you forget to stop it, it may keep using your PC. Beginners should leave it off.',
  'Save Isolation':
    'This says each game copy or bot can use a separate save/profile. The simulator uses it to stop bots from overwriting each other. For example, explorer-001 can have its own save. If this is wrong, test saves may conflict. Beginners should turn it on only if the game supports it.',
  'Save Isolation Mode':
    'This controls whether each game instance gets its own save folder or profile. The simulator uses it to stop bots from overwriting each other. For example, temp-directory creates a separate folder for each instance. If this is wrong, bots may share or damage the same save. Beginners should use temp-directory if the game supports custom save folders.',
  'Source Save Path':
    'This is the seed save folder copied before each game instance starts. The simulator uses it when every bot should begin from the same clean save. For example, /home/me/MyGameSeedSave. If this path is wrong, the game may start with no copied save or the session may fail. Beginners can leave it blank unless they already made a clean test save.',
  'Working Save Root':
    'This is the parent folder where isolated saves are created. The simulator puts one folder per game instance inside it. For example, runs/my-session/saves. If this points to the wrong place, saves may be hard to find or may use too much disk space. Beginners can leave it blank to use the session runs folder.',
  'Profile Argument Template':
    'This is an extra launch argument that tells your game which save folder or profile to use. The simulator replaces words like {savePath} and {profileId}. For example, --save-dir={savePath}. If the template is wrong, the game may ignore the isolated save. Beginners should use this only if their game supports a save-folder argument.',
  'Environment Variable Name':
    'This is the name of an environment variable that points the game to its save folder. The simulator sets it before launching the game. For example, MY_GAME_SAVE_DIR. If the name is wrong, the game will not see the isolated save path. Beginners should use this only if their game reads save paths from environment variables.',
  'Cleanup Temp Saves':
    'This deletes temporary save folders after the session stops. The simulator uses it to save disk space. For example, a short smoke test can clean up its temp saves. If this is on, you may lose useful save files for debugging. Beginners should leave it off until they know they do not need the saves.',
  'Preserve Bot Saves':
    'This keeps each bot or instance save folder after the run. The simulator uses it so you can inspect the exact save state later. For example, you can open explorer-001 save data after a bug. If this is off with cleanup enabled, temporary saves may be deleted. Beginners should leave it on.',
  'Shared Save Warning':
    'This warns that bots or game instances may use the same save/profile data. The simulator shows it when isolation is off or unsafe. For example, two game windows might both write to the same save file. If you ignore it, saves can be overwritten or corrupted. Beginners should use save isolation before running multiple instances.',
  'Save/profile':
    'This shows the save profile or folder assigned to a game instance. The simulator uses it to keep each game copy separate when isolation is enabled. For example, game-instance-001 may use its own saves folder. If it says Shared/default, bots may be sharing normal game saves. Beginners should check this before starting many bots.',
  'Save/Profile Isolation':
    'This shows whether bots and game copies can use separate save folders or profiles. The simulator uses it to stop tests from overwriting each other. For example, explorer-001 can keep its own save. If this is not ready, many game instances can damage the same save. Beginners should set up isolation before large runs.',
  Scene:
    'This filters by where the issue happened. The simulator uses it to show only one area or scene. For example, choose Start Area. If you pick the wrong scene, other issues are hidden. Beginners can leave this on All scenes.',
  Screenshots:
    'This saves pictures during testing or when issues happen. The simulator uses them as proof in reports. For example, a screenshot can show a stuck menu. If this is off, reports have less evidence. Beginners should leave it on.',
  'Save screenshots':
    'This tells the simulator to save pictures while bots test the game. The simulator uses screenshots as proof when it finds issues or when a bot gets stuck. For example, a screenshot can show a frozen loading screen. If this is off, reports may be harder to check. Beginners should leave it on if the adapter supports screenshots.',
  'Screenshot Tool':
    'This is the program your computer uses to take pictures of the game window. The simulator uses screenshots as proof when it finds a bug. For example, Linux can use gnome-screenshot, scrot, or ImageMagick import. If no screenshot tool is available, testing can still run but reports may have less evidence. Beginners should install one screenshot tool.',
  'Screenshot Evidence':
    'This is the screenshot file created during a profile test. The simulator uses screenshots as proof for issues and reports. For example, it may save a PNG in the runs folder. If this is missing, screenshot capture may be unsupported or failed. Beginners should fix screenshot support before relying on evidence.',
  'Screenshot Support Check':
    'This checks whether the current computer can take pictures of a desktop game. The simulator uses screenshots when bugs happen. For example, Linux can use gnome-screenshot, scrot, or ImageMagick import. If this is missing, reports may have less proof. Beginners should install one screenshot tool.',
  'Screenshot Every N Actions':
    'This controls how often the simulator takes a picture while bots are testing. For example, if this is 20, the bot takes a screenshot every 20 actions. Lower numbers create more screenshots but use more storage. If it is too low, the runs folder can grow quickly. For beginners, use 20 or 50.',
  'Read Browser Game State':
    'This checks whether the page exposes window.__GAMEPLAY_SIM_STATE__. The simulator uses it to read scene, player, quest, inventory, and UI data from browser games you control. If it is missing, the adapter falls back to basic page information. Beginners can leave it alone unless they are adding browser instrumentation.',
  'Reload Page':
    'This lets the adapter refresh the browser game page. The simulator uses it for recovery or reset-style actions. For example, reload can restart a stuck web build. If used at the wrong time, unsaved browser progress may be lost. Beginners should use it only for test builds.',
  Search:
    'This searches the list by words you type. The simulator uses it to hide rows that do not match. For example, type crash to find crash items. If the text is wrong, you may see no results. Beginners can leave it empty.',
  Session:
    'This chooses which test session to use. The simulator uses it to load issues, logs, or exports from that run. For example, choose session-2026-07-05. If this is wrong, you may review the wrong data. Beginners should choose the active or newest session.',
  'Session Status':
    'This shows whether a saved session is created, running, stopped, or failed. The simulator uses it to explain what happened to that run. For example, stopped means the run ended normally, and failed means setup or runtime had a serious problem. If this is unexpected, open logs. Beginners should review stopped or failed sessions first.',
  'Session ID':
    'This is the name for this test run. The simulator uses it for the run folder and reports. For example, session-smoke-test. If it is empty or reused, reports may be confusing. Beginners can keep the suggested name.',
  'Session Label':
    'This is a short tag that explains what kind of test this run is. The simulator shows it in Logs and Reports so many runs are easier to sort. For example, use Smoke Test for a quick check or Regression for comparing builds. If it is wrong, the run may be harder to find later. Beginners should choose Smoke Test for a first run.',
  'Setup Wizard':
    'This chooses the guided setup flow for your game. The simulator uses it to show only the fields that matter for that kind of game. For example, choose Browser Game Wizard for a web game URL. If this is wrong, you may see confusing fields or miss required ones. Beginners should choose the closest match to how they normally open the game.',
  Severity:
    'This filters by how serious an issue is. The simulator uses it to show only matching issues. For example, choose critical to see crashes and game-breaking problems. If you pick the wrong level, some issues are hidden. Beginners can leave this on All severities.',
  Scaling:
    'This chooses how this bot pool gets its final count. Fixed uses the desired number. Auto lets the simulator adjust based on PC resources. If this is wrong, you may run too many or too few bots. Beginners should choose Auto.',
  Source:
    'This filters logs by where they came from. The simulator uses it to show session, bot, or instance logs. For example, choose Bot actions to see only bot actions. If this is wrong, some logs are hidden. Beginners can leave this on All sources.',
  'Raw Files':
    'This view helps inspect the original saved JSON rows from the run bundle. The simulator keeps it for advanced debugging when summaries are not enough. For example, use it to check a full payload. If it feels confusing, go back to Important Events. Beginners usually do not need Raw Files.',
  'Raw File':
    'This is the saved file that the selected log came from. The simulator records it so you can find the original artifact inside the run folder. For example, it may be a bot actions file or an instance log. If it says not recorded, the log came from an older file format. Beginners usually do not need to open it directly.',
  'State Snapshots':
    'This saves small records of what the game state looked like. The simulator uses them to explain issues. For example, a snapshot may say the bot was in a menu. If this is off, reports have less context. Beginners should leave it on.',
  'State Preview':
    'This shows a small sample of game state from the profile test. The simulator uses state to help bots understand scenes, UI, quests, inventory, and performance. For example, it may show the current scene or page title. If it is empty, the adapter may only have weak awareness. Beginners should use instrumentation for richer state.',
  'Startup Flow':
    'This chooses a menu setup flow to run before normal bots start. The simulator uses it to get the game into a playable state first. For example, choose Create World to go from the main menu to a loaded world. If this is wrong, bots may start in the wrong menu or fail setup. Beginners should choose No startup flow unless the game needs menu setup.',
  'Startup timeout':
    'This is how long the simulator waits for the startup flow, in seconds. It uses this limit so a stuck menu setup does not run forever. For example, 60 means wait up to one minute. If it is too short, slow loading may fail. Beginners should use 60.',
  'Continue if startup flow fails':
    'This lets normal bots start even if the setup flow fails. The simulator uses it when you want to inspect what happens after a bad setup. For example, turn it on during experiments. If it is off, the session stops when setup fails. Beginners should leave it off.',
  'Test Startup Flow':
    'This checks whether the selected startup flow is ready to use. The simulator checks the saved flow steps before starting a real session. For example, it confirms that Create World has steps. If this fails, edit the game profile UI flow. Beginners should run this before starting bots.',
  'Startup Flow Test Result':
    'This shows the result of checking the startup flow setup. The simulator uses it to tell you if the flow has steps and a timeout. For example, it may say the flow has six steps. If it reports a problem, fix the flow before starting. Beginners should look for a ready message.',
  Status:
    'This shows the current state of a bot or game instance. The simulator uses it to decide what can happen next. For example, running means active, stopped means finished, and failed means something went wrong. If the status is unhealthy, the run may need attention. Beginners should look for running during a test and stopped after it ends.',
  'Supports Direct Actions':
    'This says the adapter can tell the game to do actions directly. The simulator uses this for accurate testing when the game exposes a test API. For example, the game may accept open_inventory without a key press. If this is wrong, actions may fail or reports may be confusing. Beginners should turn it on only for instrumented builds.',
  'Supports Multiple Instances':
    'This says the game can safely run more than one copy at the same time. The simulator uses it to run more bots in parallel. For example, two separate game windows. If this is wrong, save files or windows may conflict. Beginners should leave it off unless they tested it.',
  'Supports Save Isolation':
    'This says each game copy or bot can use a separate save or profile. The simulator uses it to stop bots from overwriting each other. For example, explorer-001 can have its own save folder. If this is wrong, save data may mix together. Beginners should turn it on only if the game supports it.',
  'Supports Screenshots':
    'This says the adapter can take pictures of the game. The simulator uses screenshots as proof when bots find issues. For example, a screenshot can show a stuck menu. If this is wrong, screenshot capture may fail. Beginners should turn it on only if screenshots work for this game.',
  'Supports State Read':
    'This says the simulator can read real game state, like scene, player, quest, or inventory data. It is used for smarter bots and better issue reports. For example, the game can say the player is in Town. If this is wrong, bots may make poor choices. Beginners should turn it on only for instrumented builds.',
  'Supports Video':
    'This says the adapter can record video evidence. The simulator uses video to show what happened before an issue. For example, a video can show a crash or softlock. If this is wrong, video capture may fail. Beginners can leave it off.',
  'Supported Capabilities':
    'This shows what the selected adapter says it can do. The simulator uses these abilities to decide how bots launch, read state, send actions, and save evidence. For example, screenshots may be supported but video may not. If a needed ability says No, that feature may fail later. Beginners should make sure launch, actions, and screenshots match their plan.',
  'Stopped bots':
    'This shows how many bots have finished or been stopped. The simulator uses it to show what is no longer active. For example, a bot may stop after reaching its action limit. If too many stop early, check logs for errors. Beginners should compare this with running bots.',
  'Stop On Critical Issue':
    'This stops the session when a game-breaking issue is found. The simulator uses it to protect the run from continuing after a crash or softlock. For example, stop after the game process crashes. If this is off, bots may keep trying after a serious problem. Beginners should leave it on.',
  'Stuck bots':
    'This shows how many bots may be blocked or making no progress. The simulator uses it to find softlocks and broken flows. For example, a bot stuck in a menu will count here. If this number grows, review issues and screenshots. Beginners should inspect stuck bots before running longer.',
  Token:
    'This is a private GitHub access token. The simulator uses it only if you explicitly post issues to GitHub. For example, paste a token with issue permission. If it is wrong, posting fails. Beginners should leave it blank and export markdown instead.',
  'Test Control':
    'This lets you try one mapped control before starting a bot session. The simulator launches the game, focuses it, sends the selected input, then stops the test instance. For example, test Jump to check that Space works. If it fails, fix the executable path, focus tool, or control mapping. Beginners should test one simple key first.',
  'Test Launch':
    'This checks whether the simulator can open or connect to the game with this profile. Use it before starting bots. For example, it can launch MyGame.exe or connect to a local adapter. If this fails, bots will not be able to test the game yet. Beginners should run this test after filling required fields.',
  'Test Result':
    'This shows whether the profile test worked. The simulator uses it to tell you if launch, health, actions, and cleanup were okay. For example, succeeded means the basic adapter path worked. If it failed, read the error below before starting bots. Beginners should only start a real session after this looks good.',
  'Page Launch Test':
    'This checks whether Playwright can open the browser game page. The simulator uses it before browser bots start testing. For example, it opens http://localhost:5173 and then closes the page. If this fails, the URL or browser setup may be wrong. Beginners should run this before a browser session.',
  'Process Stop Timeout':
    'This is how long the simulator waits for a desktop game to close nicely before forcing it to stop. It protects the computer from stuck test processes. For example, 2500 means wait 2.5 seconds. If it is too short, the game may close too harshly. Beginners should keep the default.',
  'Transport Type':
    'This is how the simulator talks to an instrumented game. The instrumented adapter uses it to choose local HTTP, WebSocket, file bridge, or plugin bridge. For example, local HTTP works with http://127.0.0.1:4555. If this is wrong, the simulator may not connect. Beginners should choose Local HTTP.',
  'Total bots':
    'This is the full number of bots in the session. The simulator uses it to summarize how many testers are active or planned. For example, 8 total bots may include explorer and combat bots. If this is wrong, check the bot pools. Beginners should keep this modest at first.',
  'UI Flow JSON':
    'This describes a menu journey the UI Journey Bot should follow. The simulator uses it for multi-step flows like Play Game, Create Game, Game Settings, and Start World. For example, one step can press Enter on Play Game. If the JSON is wrong, the bot cannot follow the flow. Beginners should start with the sample flow and edit the labels and keys.',
  'Flow Test Result':
    'This shows whether the configured UI flow looks usable. The simulator checks the flow shape before bots run it. For example, it can confirm that the first step has an action and key. If this says failed, fix the flow before starting a session. Beginners should test the full flow after editing it.',
  'UI Journey Bot':
    'This bot follows the UI flows saved in the game profile. The simulator uses it to get through layered menus before normal bots explore gameplay. For example, it can click Play Game, Create Game, then Start World. If no flow is configured, it behaves like a normal rule-based bot. Beginners should add one UI Journey Bot when the game starts in menus.',
  Untested:
    'This shows known content that bots have not reached yet. The simulator uses it to help plan future tests. For example, three untested side quests means bots have not covered them. If important content is here, add better bot pools or more time. Beginners should use it as a checklist.',
  URL:
    'This is the web address for a browser game or local instrumented endpoint. The simulator uses it to open or connect to the game. For example, http://localhost:3000 or https://example.local/game. If it is wrong, the adapter cannot connect. Beginners should use the same address they open in the browser.',
  'Use configured backend token':
    'This tells the simulator to use a token already configured outside the UI. It is used only when posting GitHub issues. For example, turn it on if the backend has a token in its settings. If it is wrong, posting may fail. Beginners should leave it off.',
  'Use Keyboard Input':
    'This means the browser adapter can press keys inside the game page. Bots use it for controls like move, jump, menu, or interact. For example, Jump might press Space. If the mapping is wrong, the bot may press the wrong key or do nothing. Beginners should test simple keyboard controls first.',
  'Use Mouse Input':
    'This means the browser adapter can click inside the game page. Bots use it for actions like attack, select, or confirm. For example, Attack might use MouseLeft. If the click point or mapping is wrong, the bot may miss the target. Beginners should prefer keyboard controls when possible.',
  Version:
    'This is the game version. The simulator uses it in reports and comparisons. For example, 1.0.0 or demo-v2. If it is wrong, reports may point to the wrong version. Beginners should write the version shown in the game or launcher.',
  Video:
    'This records video evidence if the adapter supports it. The simulator uses it to show what happened before an issue. For example, a video can show a bot getting stuck. If this is on without support, it will stay disabled. Beginners can leave it off.',
  'Save video':
    'This tells the simulator to record video if the adapter supports it. The simulator uses video to show what happened before an issue. For example, video can show the steps before a crash. If this is on for an unsupported adapter, it will not record. Beginners can leave it off until screenshots are working.',
  'Adapter Evidence':
    'This shows whether real screenshots or video proof can come from the adapter. The simulator uses this proof when it reports bugs. For example, a browser adapter can take a page screenshot. If this is not ready, reports may only have fallback proof. Beginners should get screenshots working before advanced features.',
  'Advanced Intelligence Status':
    'This shows whether smarter testing features are enabled. The simulator uses this to keep advanced tools behind the real game runtime. For example, vision should stay off until the app can launch and control your game. If this is ignored, settings may look smart but not help testing. Beginners should keep advanced features off at first.',
  'Action Replay Scripts':
    'This lets the simulator save a small script of actions that may repeat a bug. It uses the script to help you replay what the bot did. For example, move-forward, jump, then open-menu. If this is wrong, the replay may not match the real bug. Beginners should leave it off until normal reports are useful.',
  'Bot Strategy Tuning':
    'This changes how strongly bots follow certain habits. The simulator uses it to make bots more curious, careful, or bug-focused. For example, an explorer can try more unusual paths. If it is too extreme, bots may miss normal gameplay. Beginners should use the default profiles.',
  'Bot Strategy Tuning Mode':
    'This chooses the style used when strategy tuning is turned on. The simulator uses it to adjust bot choices after normal control works. For example, exploration-heavy makes bots search more places. If it is wrong, bots may test the wrong kind of behavior. Beginners should use Profile Defaults.',
  'Bug Deduplication':
    'This controls how repeated bugs are grouped. The simulator uses it to reduce duplicate reports. For example, three bots finding the same stuck menu can become one group. If this is too strict, different bugs may be grouped together. Beginners should use Basic until reports are easy to review.',
  'Engine-Specific Plugins':
    'This enables extra helpers for one game engine. The simulator may use them later for deeper Unity, Godot, or Unreal testing. For example, a Unity plugin could share better scene data. If the plugin is wrong, tests may fail or show confusing data. Beginners should use the normal adapter first.',
  Heatmaps:
    'This shows where bots spent time in the game. The simulator uses it to find tested and untested areas. For example, a map may show many visits near the start area. If position data is weak, the heatmap may be inaccurate. Beginners should use it after basic coverage works.',
  'Long Overnight Test Mode':
    'This prepares settings for a long test while you are away. The simulator uses it to favor safer limits, logs, and reports. For example, run bots overnight on a stable dev build. If your setup is not stable, it may waste time or disk space. Beginners should do short runs first.',
  'Map Memory':
    'This lets bots remember places they have visited. The simulator uses it for better exploration later. For example, a bot can avoid checking the same hallway too often. If the game state is weak, the map may be wrong. Beginners should leave it off until real state or screenshots are working.',
  'Performance Graphs':
    'This draws computer and game speed over time. The simulator uses it to spot slowdowns. For example, a graph can show memory rising every minute. If performance data is missing, the graph may be incomplete. Beginners should use it after normal sessions run cleanly.',
  'Persistent Reports':
    'This shows whether old sessions and reports are saved on disk. The simulator uses saved runs so results survive app restarts. For example, yesterday’s session can still be opened from Reports. If this is not ready, advanced comparisons may lose data. Beginners should check reports after a short run.',
  'Quest Inference':
    'This lets bots guess what a quest wants next. The simulator uses it later when the game does not give perfect quest data. For example, it may guess that Find the Key needs a locked door. If the guess is wrong, bots may waste time. Beginners should keep it off until quest data is reliable.',
  'Real Adapter Runtime':
    'This shows whether the app has the real adapter path available. The simulator uses adapters to launch, control, and read real games. For example, DesktopWindowAdapter can launch an executable. If this is not ready, smart features would only decorate mock data. Beginners should test a real profile first.',
  'Real Runtime Prerequisite':
    'This confirms that real game launch, control, state, evidence, and reports work before smarter features are enabled. The simulator uses it as a safety gate. For example, turn it on after a real adapter session starts and stops correctly. If you turn it on too early, advanced settings may not help. Beginners should leave it off until a simple real run works.',
  'Vision Model':
    'This lets the simulator understand screenshots better. It can help bots notice menus, buttons, enemies, stuck screens, or visual bugs. This is advanced and may use more computer power. If it is wrong or too heavy, testing may slow down. Beginners should leave it off until normal testing works.',
  'Vision Model Mode':
    'This chooses where screenshot understanding will run. The simulator may later use a local model or an external service. For example, local means it runs on your computer. If this is wrong, it may be slow, fail, or use the wrong tool. Beginners should keep it Off.',
  'With issues':
    'This shows how much tested content had problems. The simulator uses it to connect coverage with bugs. For example, one scene with issues may need closer review. If this number is high, open the Issues page. Beginners should fix critical issues first.',
  'Working Directory':
    'This is the folder the game starts from. The simulator uses it so the game can find its data files. For example, the folder that contains MyGame.exe. If it is wrong, the game may open without assets or not start. Beginners can leave it blank unless the game needs it.'
};

const knownContentHelpText: Record<string, string> = {
  Achievements:
    'This lists achievements you want bots to notice or try. The simulator uses it for coverage reports. For example, First Win. If it is wrong, achievement coverage may be misleading. Beginners can leave it blank.',
  Bosses:
    'This lists important boss fights. The simulator uses it to track whether bots reached them. For example, Cave Guardian. If it is wrong, boss coverage may be misleading. Beginners can add one boss per line.',
  Collectibles:
    'This lists collectible items in the game. The simulator uses it to track optional collection coverage. For example, Golden Coin. If it is wrong, collectible reports may be off. Beginners can leave it blank.',
  'Dialogue Branches':
    'This lists dialogue choices or branches. The simulator uses it to see which conversations were tested. For example, help the guard or refuse. If it is wrong, dialogue coverage may be unclear. Beginners can add important branches only.',
  Endings:
    'This lists possible endings. The simulator uses it to track end-game coverage when possible. For example, Good Ending. If it is wrong, ending coverage may be misleading. Beginners can leave it blank for early builds.',
  'Hidden Areas':
    'This lists secret or hard-to-find places. The simulator uses it so optional areas are not ignored. For example, Hidden Cave. If it is wrong, reports may miss secret content. Beginners can add one area per line.',
  Items:
    'This lists important items. The simulator uses it to track item and inventory coverage. For example, Silver Key. If it is wrong, item coverage may be confusing. Beginners can add only important items first.',
  Levels:
    'This lists game levels. The simulator uses it to track where bots have been. For example, Forest Level. If it is wrong, coverage reports may be misleading. Beginners can add one level per line.',
  'Main Quests':
    'This lists the main story quests. The simulator uses it to track story progress. For example, Find the Lost Ship. If it is wrong, main story coverage may be off. Beginners should add the core story goals.',
  Menus:
    'This lists menus that should be tested. The simulator uses it for UI coverage. For example, Settings or Inventory. If it is wrong, UI testing may miss menus. Beginners can add the main menus.',
  Minigames:
    'This lists minigames or special activities. The simulator uses it so extra content is not ignored. For example, Fishing Challenge. If it is wrong, coverage may be incomplete. Beginners can leave it blank if none exist.',
  Notes:
    'This is extra information about the game profile. The simulator stores it for people reading the profile. For example, use the debug build for testing. If it is wrong, teammates may be confused. Beginners can leave it blank.',
  NPCs:
    'This lists characters bots should interact with. The simulator uses it to track NPC coverage. For example, Shopkeeper Mia. If it is wrong, reports may miss important people. Beginners can add important NPCs first.',
  'Optional Stories':
    'This lists optional story content. The simulator uses it so side stories are not ignored. For example, Lost Puppy story. If it is wrong, optional coverage may be off. Beginners can add one story per line.',
  'Post-Game Content':
    'This lists content after the main ending. The simulator uses it when a bot can reach late-game testing. For example, New Game Plus. If it is wrong, post-game coverage may be unclear. Beginners can leave it blank.',
  Quests:
    'This lists quests in the game. The simulator uses it for quest coverage reports. For example, Help the Farmer. If it is wrong, reports may count the wrong quests. Beginners can add one quest per line.',
  Scenes:
    'This lists places or scenes in the game. The simulator uses it to measure coverage. For example, Town, Forest, or Cave. If it is wrong, coverage reports may be confusing. Beginners can add one scene per line.',
  Shops:
    'This lists shops or vendors. The simulator uses it to test buying, selling, and economy rules. For example, General Store. If it is wrong, shop coverage may be off. Beginners can add key shops only.',
  'Side Quests':
    'This lists optional quests. The simulator uses it so side content gets tested too. For example, Find the Lost Ring. If it is wrong, side quest coverage may be misleading. Beginners can add the important side quests.'
};

function classNames(...names: Array<string | undefined>): string {
  return names.filter(Boolean).join(' ');
}

function helpTextForLabel(label: string, customHelpText?: FieldHelpText): FieldHelpText {
  if (customHelpText) {
    return customHelpText;
  }

  return (
    fieldHelpText[label] ??
    knownContentHelpText[label] ??
    `This field controls ${label.toLowerCase()}. The simulator uses it while setting up or reviewing a test. For example, choose the value that matches what you want to test. If it is wrong, the app may show the wrong results or use the wrong setting. Beginners should keep the default unless they know what to change.`
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function measureTooltipSize(rect: TooltipSize, viewport: TooltipViewport): TooltipSize {
  const maxWidth = Math.min(TOOLTIP_MAX_WIDTH, Math.max(160, viewport.width - TOOLTIP_MARGIN * 2));
  const maxHeight = Math.max(96, Math.floor(viewport.height * TOOLTIP_MAX_HEIGHT_RATIO));

  return {
    width: Math.min(rect.width || TOOLTIP_DEFAULT_WIDTH, maxWidth),
    height: Math.min(rect.height || TOOLTIP_DEFAULT_HEIGHT, maxHeight)
  };
}

function placementCoordinates(
  placement: TooltipPlacement,
  anchorRect: TooltipRect,
  tooltipSize: TooltipSize
): Pick<TooltipPosition, 'left' | 'top'> {
  const anchorCenterX = anchorRect.left + anchorRect.width / 2;
  const anchorCenterY = anchorRect.top + anchorRect.height / 2;

  switch (placement) {
    case 'top':
      return {
        left: anchorCenterX - tooltipSize.width / 2,
        top: anchorRect.top - tooltipSize.height - TOOLTIP_GAP
      };
    case 'right':
      return {
        left: anchorRect.right + TOOLTIP_GAP,
        top: anchorCenterY - tooltipSize.height / 2
      };
    case 'left':
      return {
        left: anchorRect.left - tooltipSize.width - TOOLTIP_GAP,
        top: anchorCenterY - tooltipSize.height / 2
      };
    case 'bottom':
    default:
      return {
        left: anchorCenterX - tooltipSize.width / 2,
        top: anchorRect.bottom + TOOLTIP_GAP
      };
  }
}

function fallbackPlacement(
  preferredPlacement: TooltipPlacement,
  anchorRect: TooltipRect,
  tooltipSize: TooltipSize,
  viewport: TooltipViewport
): TooltipPlacement {
  const bottomFits = anchorRect.bottom + TOOLTIP_GAP + tooltipSize.height <= viewport.height - TOOLTIP_MARGIN;
  const topFits = anchorRect.top - TOOLTIP_GAP - tooltipSize.height >= TOOLTIP_MARGIN;
  const rightFits = anchorRect.right + TOOLTIP_GAP + tooltipSize.width <= viewport.width - TOOLTIP_MARGIN;
  const leftFits = anchorRect.left - TOOLTIP_GAP - tooltipSize.width >= TOOLTIP_MARGIN;

  if (preferredPlacement === 'bottom') {
    return bottomFits ? 'bottom' : 'top';
  }

  if (preferredPlacement === 'top') {
    return topFits ? 'top' : 'bottom';
  }

  if (preferredPlacement === 'right') {
    return rightFits ? 'right' : 'left';
  }

  return leftFits ? 'left' : 'right';
}

export function calculateViewportSafeTooltipPosition(
  anchorRect: TooltipRect,
  tooltipRect: TooltipSize,
  viewport: TooltipViewport,
  preferredPlacement: TooltipPlacement = 'bottom'
): TooltipPosition {
  const maxWidth = Math.min(TOOLTIP_MAX_WIDTH, Math.max(160, viewport.width - TOOLTIP_MARGIN * 2));
  const maxHeight = Math.max(96, Math.floor(viewport.height * TOOLTIP_MAX_HEIGHT_RATIO));
  const tooltipSize = measureTooltipSize(tooltipRect, viewport);
  const placement = fallbackPlacement(preferredPlacement, anchorRect, tooltipSize, viewport);
  const coordinates = placementCoordinates(placement, anchorRect, tooltipSize);
  const left = clamp(coordinates.left, TOOLTIP_MARGIN, viewport.width - tooltipSize.width - TOOLTIP_MARGIN);
  const top = clamp(coordinates.top, TOOLTIP_MARGIN, viewport.height - tooltipSize.height - TOOLTIP_MARGIN);

  return {
    left: Math.round(left + viewport.scrollX),
    top: Math.round(top + viewport.scrollY),
    maxWidth,
    maxHeight,
    placement
  };
}

function getTooltipRoot(): HTMLElement | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const existingRoot = document.getElementById('tooltip-root');

  if (existingRoot) {
    return existingRoot;
  }

  return document.body;
}

function viewportFromWindow(): TooltipViewport {
  return {
    width: window.innerWidth || document.documentElement.clientWidth || 1024,
    height: window.innerHeight || document.documentElement.clientHeight || 768,
    scrollX: window.scrollX || window.pageXOffset || 0,
    scrollY: window.scrollY || window.pageYOffset || 0
  };
}

function TooltipLayer({
  anchorElement,
  helpText,
  label,
  onRequestClose,
  onTooltipMouseEnter,
  onTooltipMouseLeave,
  tooltipId
}: {
  anchorElement: HTMLElement;
  helpText: FieldHelpText;
  label: string;
  onRequestClose: () => void;
  onTooltipMouseEnter: () => void;
  onTooltipMouseLeave: () => void;
  tooltipId: string;
}) {
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<TooltipPosition | null>(null);

  const updatePosition = useCallback(() => {
    const tooltipElement = tooltipRef.current;

    if (!tooltipElement) {
      return;
    }

    const nextPosition = calculateViewportSafeTooltipPosition(
      anchorElement.getBoundingClientRect(),
      tooltipElement.getBoundingClientRect(),
      viewportFromWindow(),
      'bottom'
    );

    setPosition(nextPosition);
  }, [anchorElement]);

  useLayoutEffect(() => {
    updatePosition();
  }, [helpText, updatePosition]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onRequestClose();
      }
    };

    const closeOnViewportChange = () => {
      onRequestClose();
    };

    window.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', closeOnViewportChange);
    window.addEventListener('scroll', closeOnViewportChange, true);

    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', closeOnViewportChange);
      window.removeEventListener('scroll', closeOnViewportChange, true);
    };
  }, [onRequestClose]);

  const tooltipRoot = getTooltipRoot();

  if (!tooltipRoot) {
    return null;
  }

  const style: CSSProperties = {
    left: position ? `${position.left}px` : 0,
    maxHeight: position ? `${position.maxHeight}px` : '45vh',
    maxWidth: position ? `${position.maxWidth}px` : `${TOOLTIP_MAX_WIDTH}px`,
    top: position ? `${position.top}px` : 0,
    visibility: position ? 'visible' : 'hidden',
    zIndex: TOOLTIP_LAYER_Z_INDEX
  };

  return createPortal(
    <span
      ref={tooltipRef}
      className="field-help__tooltip"
      data-placement={position?.placement ?? 'bottom'}
      id={tooltipId}
      onMouseEnter={onTooltipMouseEnter}
      onMouseLeave={onTooltipMouseLeave}
      role="tooltip"
      style={style}
    >
      {helpText}
      <span className="sr-only"> Help for {label}</span>
    </span>,
    tooltipRoot
  );
}

export function FieldHelp({ label, helpText }: { label: string; helpText: FieldHelpText }) {
  const tooltipId = useId();
  const helpRef = useRef<HTMLSpanElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const openTooltip = useCallback(() => {
    clearCloseTimer();
    setIsOpen(true);
  }, [clearCloseTimer]);

  const closeTooltip = useCallback(() => {
    clearCloseTimer();
    setIsOpen(false);
  }, [clearCloseTimer]);

  const scheduleCloseTooltip = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setIsOpen(false);
      closeTimerRef.current = null;
    }, 80);
  }, [clearCloseTimer]);

  useEffect(() => clearCloseTimer, [clearCloseTimer]);

  return (
    <span
      ref={helpRef}
      className="field-help"
      tabIndex={0}
      aria-label={`Help for ${label}`}
      aria-describedby={isOpen ? tooltipId : undefined}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onFocus={openTooltip}
      onBlur={closeTooltip}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          closeTooltip();
        }
      }}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onMouseEnter={openTooltip}
      onMouseLeave={scheduleCloseTooltip}
    >
      <span className="field-help__mark" aria-hidden="true">
        ?
      </span>
      {isOpen && helpRef.current ? (
        <TooltipLayer
          anchorElement={helpRef.current}
          helpText={helpText}
          label={label}
          onRequestClose={closeTooltip}
          onTooltipMouseEnter={clearCloseTimer}
          onTooltipMouseLeave={closeTooltip}
          tooltipId={tooltipId}
        />
      ) : null}
    </span>
  );
}

export function FieldLabel({ label, helpText, htmlFor, className }: FieldLabelProps) {
  const text = helpTextForLabel(label, helpText);

  return (
    <span className={classNames('field__label', 'field-label', className)}>
      {htmlFor ? (
        <label className="field-label__text" htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <span className="field-label__text">{label}</span>
      )}
      <FieldHelp label={label} helpText={text} />
    </span>
  );
}

export function TextInput({ label, error, id, className, helpText, ...props }: InputProps) {
  const generatedId = useId();
  const fieldId = id ?? props.name ?? generatedId;

  return (
    <div className="field">
      <FieldLabel label={label} htmlFor={fieldId} helpText={helpText} />
      <input id={fieldId} className={classNames('input', className)} {...props} />
      {error ? <span className="field__error">{error}</span> : null}
    </div>
  );
}

export function SelectInput({ label, error, id, className, helpText, children, ...props }: SelectProps) {
  const generatedId = useId();
  const fieldId = id ?? props.name ?? generatedId;

  return (
    <div className="field">
      <FieldLabel label={label} htmlFor={fieldId} helpText={helpText} />
      <select id={fieldId} className={classNames('input', className)} {...props}>
        {children}
      </select>
      {error ? <span className="field__error">{error}</span> : null}
    </div>
  );
}

export function TextareaInput({ label, error, id, className, helpText, ...props }: TextareaProps) {
  const generatedId = useId();
  const fieldId = id ?? props.name ?? generatedId;

  return (
    <div className="field field--wide">
      <FieldLabel label={label} htmlFor={fieldId} helpText={helpText} />
      <textarea id={fieldId} className={classNames('input', 'input--textarea', className)} {...props} />
      {error ? <span className="field__error">{error}</span> : null}
    </div>
  );
}

export function ToggleInput({ label, id, className, helpText, ...props }: ToggleProps) {
  const generatedId = useId();
  const fieldId = id ?? props.name ?? generatedId;

  return (
    <div className={classNames('toggle-row', className)}>
      <input id={fieldId} type="checkbox" {...props} />
      <FieldLabel label={label} htmlFor={fieldId} helpText={helpText} className="toggle-row__label" />
    </div>
  );
}
