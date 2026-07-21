import { FieldLabel } from '../components/FormFields';

type HelpItem = {
  label: string;
  helpText: string;
  body: string;
};

type HelpSection = {
  title: string;
  helpText: string;
  items: HelpItem[];
};

const conceptItems: HelpItem[] = [
  {
    label: 'GameplaySimulator',
    helpText:
      'This is the app you are using. It helps bots test games you own or have permission to test. It is used for game QA, not cheating. Beginners should use it on local or test builds first.',
    body: 'GameplaySimulator opens your game, runs test bots, records what happened, and helps you review possible problems.'
  },
  {
    label: 'Game Profile',
    helpText:
      'This is the saved setup for one game. It tells the simulator how to start the game and what kind of adapter to use. For example, a browser profile stores a URL. If it is wrong, the game may not start. Beginners should create one profile per game build.',
    body: 'A game profile stores the game name, launch method, adapter, controls, screenshots, save isolation, and known content.'
  },
  {
    label: 'Adapter',
    helpText:
      'This is the bridge between the simulator and your game. It is used to launch, read, control, and capture evidence. For example, BrowserAdapter opens a web game, and DesktopWindowAdapter opens an executable. Beginners should choose the adapter that matches how they normally open the game.',
    body: 'Adapters let the simulator talk to different game types without making the app browser-only or engine-only.'
  },
  {
    label: 'Bot Profiles',
    helpText:
      'These are reusable bot personalities. The simulator uses them to decide what each bot tries. For example, a UI tester opens menus, while an explorer checks paths. Beginners should start with one simple bot.',
    body: 'Bot profiles describe playstyle, goals, action preferences, and safe count ranges.'
  },
  {
    label: 'Session',
    helpText:
      'This is one test run. The simulator uses a session to store config, bots, logs, issues, screenshots, and reports. For example, one session can test build 42 for 30 actions. If a session fails, check whether setup or runtime failed.',
    body: 'A session is the full test run from start to stop, including the game instances and bots.'
  },
  {
    label: 'Logs',
    helpText:
      'Logs are a timeline of what happened. The simulator uses them to show launches, bot actions, warnings, and errors. For example, a log may say a bot pressed Jump. Beginners should open logs when a test fails.',
    body: 'Logs help explain the order of events before an issue or stopped session.'
  },
  {
    label: 'Issues',
    helpText:
      'Issues are possible bugs found by the simulator. They are not always confirmed bugs. For example, a stuck menu may be a real bug or a bad control mapping. Beginners should review screenshots and logs before marking an issue confirmed.',
    body: 'Issues group possible crashes, stuck states, UI problems, quest problems, performance problems, and possible exploits.'
  },
  {
    label: 'Screenshots',
    helpText:
      'Screenshots are pictures captured during a test. The simulator uses them as proof when something goes wrong. For example, a screenshot can show a frozen loading screen. Beginners should keep screenshots on.',
    body: 'Screenshots make reports easier to trust because you can see what the bot saw.'
  },
  {
    label: 'Reports',
    helpText:
      'Reports are readable summaries saved after a run. The simulator uses them so you do not need to inspect raw JSON logs. For example, a report lists bot counts, issues, coverage, and evidence. Beginners should open the report after every first test.',
    body: 'Reports explain what was tested, what failed, what evidence was saved, and what to check next.'
  }
];

const quickStartItems: HelpItem[] = [
  {
    label: 'Create game profile',
    helpText:
      'This is the first setup step. The simulator needs it to know which game to open and how to control it. For example, create a Desktop profile for MyGame.exe. If you skip it, there is no game to test.',
    body: 'Open Game Profiles, create a profile, choose the game type, and fill only the required fields first.'
  },
  {
    label: 'Test launch',
    helpText:
      'This checks whether the simulator can open or connect to the game. It is used before bots start. For example, it can open a browser URL or executable. If it fails, fix the profile before making a session.',
    body: 'Use the profile test button and confirm the game opens, connects, or reports a clear setup error.'
  },
  {
    label: 'Create session',
    helpText:
      'This makes one test run from a game profile and bot pools. The simulator uses it to decide how many bots to run and what evidence to save. Beginners should keep it small.',
    body: 'Open New Session, choose the game profile, use one bot pool, and keep bot counts low.'
  },
  {
    label: 'Start session',
    helpText:
      'This begins the real test. The simulator launches game instances first, then starts bots. If launch fails, the session may stop before any bot runs. Beginners should watch the first run.',
    body: 'Start the session only after the viability panel looks safe and there are no fatal setup errors.'
  },
  {
    label: 'Watch live session',
    helpText:
      'This shows what is happening right now. The simulator uses it to show bots, instances, stuck states, issues, and logs. Beginners should keep this page open during the first test.',
    body: 'Open Live Session and watch bot status, instance health, issue count, and recent logs.'
  },
  {
    label: 'Open report',
    helpText:
      'This opens the readable result after the run. The simulator uses it to summarize the test without raw files. If no report appears, reload sessions or check logs. Beginners should read the report before changing many settings.',
    body: 'When the session stops, open Reports, choose the newest run, and review issues and evidence.'
  }
];

const adapterSections: HelpSection[] = [
  {
    title: 'Browser Game First Test',
    helpText:
      'Use this when your game runs in a web browser. The simulator opens the URL with the browser adapter. Beginners should test a local development server first.',
    items: [
      {
        label: 'Start local game server',
        helpText:
          'This starts your browser game on your computer. The simulator needs a URL it can open. For example, http://localhost:5173. If the server is not running, the page will fail to load.',
        body: 'Run your game normally, then copy the local URL from your browser.'
      },
      {
        label: 'Paste URL',
        helpText:
          'This is the web address of the game. The simulator uses it to open the page. For example, http://localhost:5173. If it is wrong, bots will test the wrong page or nothing at all.',
        body: 'Put the game URL in the Game URL field.'
      },
      {
        label: 'Choose browser adapter',
        helpText:
          'This tells the simulator to use Playwright and browser controls. It is used only for browser games. Beginners should use Chromium unless they need another browser.',
        body: 'Set Adapter Type to Browser and keep browser type as Chromium for the first run.'
      },
      {
        label: 'Add keyboard/mouse mappings',
        helpText:
          'These mappings tell bots which keys or clicks control the game. For example, Jump might use Space. If mappings are wrong, bots may do nothing. Beginners should map only the main controls first.',
        body: 'Map simple actions like move, interact, confirm, cancel, and menu.'
      },
      {
        label: 'Run 1 UI tester bot',
        helpText:
          'This uses one bot that checks menus and interface actions. The simulator uses it for a safe first browser test. More bots can wait until the first run works.',
        body: 'Use one UI tester bot with fixed scaling and a small action limit.'
      },
      {
        label: 'Screenshots on, video off',
        helpText:
          'Screenshots give proof without using too much disk space. Video can be heavy. Beginners should turn screenshots on and leave video off until screenshots work.',
        body: 'Save screenshots, skip video, and open evidence from the Issues page if anything appears.'
      }
    ]
  },
  {
    title: 'Desktop Game First Test',
    helpText:
      'Use this when your game starts from an executable file. The simulator opens the game window and sends keyboard or mouse input. Beginners should use a dev build without anti-cheat.',
    items: [
      {
        label: 'Choose executable path',
        helpText:
          'This is the file that starts your desktop game. The simulator uses it to launch the game. For example, MyGame.exe or ./MyGame.x86_64. If it is wrong, the game will not start.',
        body: 'Pick the same file you normally double-click to open the game.'
      },
      {
        label: 'Add working directory',
        helpText:
          'This is the folder the game starts from. The simulator uses it so the game can find its data files. If it is wrong, the game may open without assets. Beginners can use the executable folder.',
        body: 'Use the folder that contains the executable or the game data folder.'
      },
      {
        label: 'Map controls',
        helpText:
          'Controls tell the bot which key or mouse button matches a game action. For example, Interact can be E. Wrong controls make bots press the wrong thing.',
        body: 'Map movement, interact, menu, confirm, cancel, and one main action.'
      },
      {
        label: 'Test launch',
        helpText:
          'This checks whether the desktop adapter can start the game. It is used before a bot session. If it fails, fix path, working directory, or permissions first.',
        body: 'Run the profile launch test before starting bots.'
      },
      {
        label: 'Test one control',
        helpText:
          'This sends one mapped key or click before a full run. The simulator uses it to prove input works. For example, test Jump. If it fails, fix focus or control mapping.',
        body: 'Try a safe control like menu or jump, then check the game reacted.'
      },
      {
        label: 'Run 1 bot',
        helpText:
          'One bot is safer for the first desktop run. The simulator uses fewer resources and avoids window focus conflicts. Beginners should run one explorer or UI tester first.',
        body: 'Start with one bot, one game instance, and a short action limit.'
      }
    ]
  },
  {
    title: 'Unity First Test',
    helpText:
      'Use this for Unity games. Instrumentation gives the best state and actions, but desktop fallback can still test a normal window. Beginners should choose the safest method that works.',
    items: [
      {
        label: 'Prefer instrumentation',
        helpText:
          'Instrumentation lets the game share state and actions directly. The simulator uses it for better bot decisions and reports. If it is not available, use desktop fallback.',
        body: 'Use the instrumentation SDK or local endpoint when your Unity build can expose one.'
      },
      {
        label: 'Desktop fallback',
        helpText:
          'This controls Unity like a normal desktop game. It is weaker than instrumentation but still useful. If controls are wrong, bots may not make progress.',
        body: 'Use fallback when you only have an executable and input mappings.'
      },
      {
        label: 'Required fields',
        helpText:
          'These are the minimum fields needed to test. Instrumented mode needs an endpoint. Desktop fallback needs executable, working directory, and controls. Missing fields stop the test.',
        body: 'Fill endpoint for instrumented mode, or executable path and controls for fallback mode.'
      },
      {
        label: 'Recommended safe first bot',
        helpText:
          'This is the first bot type to try. The simulator uses it for a small, low-risk test. For Unity, a UI tester or explorer is a good start.',
        body: 'Run one UI tester or one explorer for 20 to 30 actions.'
      }
    ]
  },
  {
    title: 'Godot First Test',
    helpText:
      'Use this for Godot games. Instrumented testing gives better state, while desktop fallback can test exported builds. Beginners should start with one bot.',
    items: [
      {
        label: 'Prefer instrumentation',
        helpText:
          'Instrumentation lets Godot share scene, player, UI, and event data. The simulator uses it to understand the game better. If it is missing, use desktop fallback.',
        body: 'Expose a local endpoint if your Godot dev build can do it.'
      },
      {
        label: 'Desktop fallback',
        helpText:
          'This opens the Godot export as a normal game window. The simulator uses mapped keys and screenshots. If state is weak, reports may have less detail.',
        body: 'Use fallback with executable path, working directory, and simple controls.'
      },
      {
        label: 'Required fields',
        helpText:
          'These fields let the simulator connect or launch. Missing endpoint, executable path, or controls can stop the test. Beginners should clear profile warnings first.',
        body: 'Fill endpoint for instrumented mode, or executable and controls for fallback mode.'
      },
      {
        label: 'Recommended safe first bot',
        helpText:
          'A safe first bot does simple actions and keeps the run small. For Godot, explorer or UI tester is usually enough. More bots can come later.',
        body: 'Run one explorer or UI tester for 20 to 30 actions.'
      }
    ]
  },
  {
    title: 'Unreal First Test',
    helpText:
      'Use this for Unreal games. Instrumentation is best for state and events, while desktop fallback can test a packaged build. Beginners should avoid heavy graphics settings at first.',
    items: [
      {
        label: 'Prefer instrumentation',
        helpText:
          'Instrumentation lets Unreal share useful test data directly. The simulator uses it for better issue reports. If your build cannot expose it yet, use fallback.',
        body: 'Use an instrumented dev build when possible.'
      },
      {
        label: 'Desktop fallback',
        helpText:
          'This controls Unreal through the game window. It is useful for packaged builds but has weaker awareness. If input focus fails, bots may not control the game.',
        body: 'Use executable path, working directory, and mapped keyboard or mouse controls.'
      },
      {
        label: 'Required fields',
        helpText:
          'These fields are needed before testing. Instrumented mode needs endpoint details. Desktop fallback needs launch and control fields. Missing fields cause setup failure.',
        body: 'Fill endpoint for instrumentation, or executable path, working directory, and controls for fallback.'
      },
      {
        label: 'Recommended safe first bot',
        helpText:
          'This keeps the first Unreal run light. Unreal builds can use more CPU and GPU. Beginners should start with one UI tester or explorer.',
        body: 'Run one UI tester or explorer, video off, screenshots on.'
      }
    ]
  },
  {
    title: 'Custom Engine First Test',
    helpText:
      'Use this when your game has its own engine or a plugin adapter. The simulator can use an instrumented endpoint if you provide one, or desktop fallback if not.',
    items: [
      {
        label: 'Instrumented endpoint if possible',
        helpText:
          'This is a local address where your game shares state and actions. The simulator uses it for stronger testing. For example, http://localhost:4317. If wrong, the adapter cannot connect.',
        body: 'Expose health, state, actions, and action endpoints if your engine can.'
      },
      {
        label: 'Desktop fallback otherwise',
        helpText:
          'This opens your custom engine game as a normal app. The simulator uses keys, mouse, and screenshots. It works with less game knowledge.',
        body: 'Use executable path and control mappings when no endpoint exists.'
      },
      {
        label: 'Start very small',
        helpText:
          'This protects your first custom-engine run. The simulator uses fewer actions and less load. If the setup is wrong, a small run is easier to fix.',
        body: 'Run one bot, one instance, and 20 to 30 actions before increasing scope.'
      }
    ]
  }
];

const readingResultItems: HelpItem[] = [
  {
    label: 'Passed launch',
    helpText:
      'This means the app could open or connect to the game. It does not mean the game has no bugs. Beginners should still run a session and read the report.',
    body: 'A launch pass only proves setup reached the game.'
  },
  {
    label: 'Failed profile test',
    helpText:
      'This usually means setup is wrong. The simulator may not find the executable, URL, endpoint, screenshot tool, or input driver. Beginners should fix the profile before changing bot settings.',
    body: 'Fix profile fields first when the profile test fails.'
  },
  {
    label: 'Failed session',
    helpText:
      'This means the runtime or test run had a problem. The simulator may have launched the game but hit adapter, bot, resource, or evidence trouble. Beginners should open logs and issues.',
    body: 'Check session logs, instance status, and the first error message.'
  },
  {
    label: 'Potential bugs',
    helpText:
      'Issues are possible bugs, not guaranteed bugs. The simulator uses evidence and confidence to help you decide. Beginners should review screenshots and last actions.',
    body: 'Confirm issues by reading evidence before filing a bug.'
  },
  {
    label: 'Evidence',
    helpText:
      'Evidence is proof for a result. The simulator uses logs, screenshots, action timelines, and reports. If evidence is missing, check adapter screenshot support and logs.',
    body: 'Use screenshots and logs together to understand what happened.'
  }
];

const failureItems: HelpItem[] = [
  {
    label: 'Read the first error',
    helpText:
      'The first error often explains the real problem. The simulator logs later errors too, but they may be side effects. Beginners should fix the first clear error first.',
    body: 'Open Logs and look for the earliest warning or error in the run.'
  },
  {
    label: 'Check setup fields',
    helpText:
      'Setup fields tell the simulator how to open and control the game. Wrong path, URL, endpoint, or controls can make a good game look broken. Beginners should rerun profile test after changes.',
    body: 'Recheck executable path, URL, endpoint, working directory, and control mappings.'
  },
  {
    label: 'Lower the load',
    helpText:
      'Lower load means fewer bots and fewer game instances. The simulator uses this to protect your PC. If the game stutters or crashes, reduce counts first.',
    body: 'Use one bot, one instance, longer action delay, screenshots on, and video off.'
  },
  {
    label: 'Use evidence',
    helpText:
      'Evidence helps you tell setup problems from game bugs. The simulator saves screenshots, logs, and reports when it can. Beginners should open evidence before changing many settings.',
    body: 'Open the issue details, screenshot, last actions, and report summary.'
  }
];

const safeSettingItems: HelpItem[] = [
  {
    label: '1 bot',
    helpText:
      'This keeps the first run simple. The simulator uses fewer resources and the result is easier to read. Beginners should start with one bot.',
    body: 'Use one UI tester or explorer.'
  },
  {
    label: '20 to 30 actions',
    helpText:
      'This limits how long the bot runs. The simulator stops after the action count. If setup is wrong, a short run fails faster and is easier to debug.',
    body: 'Use 20 to 30 actions for the first test.'
  },
  {
    label: 'Screenshots on',
    helpText:
      'Screenshots save proof without too much overhead. The simulator attaches them to issues when possible. Beginners should keep this on.',
    body: 'Save screenshots for the first run.'
  },
  {
    label: 'Video off',
    helpText:
      'Video can use more disk and CPU. The simulator can run without it. Beginners should leave it off until screenshots work.',
    body: 'Skip video for the first run.'
  },
  {
    label: 'State snapshots off unless instrumented',
    helpText:
      'State snapshots are most useful when the game exposes real state. The simulator uses them in reports. If the adapter only sees a window, snapshots may be weak.',
    body: 'Turn snapshots on only for instrumented games at first.'
  },
  {
    label: 'Action delay 500 to 750 ms',
    helpText:
      'This waits between bot actions. The simulator uses it so games have time to react. If it is too low, inputs may be missed. Beginners should use 500 to 750 ms.',
    body: 'Use slower inputs until the game responds reliably.'
  },
  {
    label: 'Stop on critical issue on',
    helpText:
      'This stops the run after a serious problem like a crash. The simulator uses it to avoid wasting time after a game-breaking failure. Beginners should leave it on.',
    body: 'Keep this on for first tests.'
  }
];

function HelpHeading({ title, helpText }: { title: string; helpText: string }) {
  return (
    <h2>
      <FieldLabel label={title} helpText={helpText} />
    </h2>
  );
}

function HelpCard({ item }: { item: HelpItem }) {
  return (
    <article className="help-card">
      <FieldLabel label={item.label} helpText={item.helpText} />
      <p>{item.body}</p>
    </article>
  );
}

function HelpList({ items }: { items: HelpItem[] }) {
  return (
    <div className="help-list">
      {items.map((item) => (
        <HelpCard key={item.label} item={item} />
      ))}
    </div>
  );
}

export function HelpFirstTestPage() {
  return (
    <section className="page-stack help-page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Guide</p>
          <h1>Help / First Test</h1>
        </div>
      </div>

      <section className="form-section">
        <HelpHeading
          title="What This App Does"
          helpText="This section explains the basic words used by GameplaySimulator. The simulator uses these parts together to run a game test. Beginners should read this before creating a first session."
        />
        <div className="help-card-grid">
          {conceptItems.map((item) => (
            <HelpCard key={item.label} item={item} />
          ))}
        </div>
      </section>

      <section className="form-section">
        <HelpHeading
          title="Quick Start"
          helpText="This is the shortest path to a first test. The simulator uses these steps in order: profile, launch test, session, live view, and report. Beginners should follow this list before changing advanced settings."
        />
        <HelpList items={quickStartItems} />
      </section>

      {adapterSections.map((section) => (
        <section className="form-section" key={section.title}>
          <HelpHeading title={section.title} helpText={section.helpText} />
          <HelpList items={section.items} />
        </section>
      ))}

      <section className="form-section">
        <HelpHeading
          title="Reading Results"
          helpText="This section explains what test results mean. The simulator uses different result types to separate setup problems from possible game bugs. Beginners should read results before changing many settings."
        />
        <HelpList items={readingResultItems} />
      </section>

      <section className="form-section">
        <HelpHeading
          title="When A Test Fails"
          helpText="This section explains what to check after a failed test. The simulator records logs and evidence to help you find the cause. Beginners should start with setup and load before assuming the game is broken."
        />
        <HelpList items={failureItems} />
      </section>

      <section className="form-section">
        <HelpHeading
          title="Safe First Settings"
          helpText="These are small settings for a first run. The simulator uses them to avoid overloading the PC and to make results easier to read. Beginners should start here."
        />
        <div className="help-settings-grid">
          {safeSettingItems.map((item) => (
            <HelpCard key={item.label} item={item} />
          ))}
        </div>
      </section>
    </section>
  );
}
