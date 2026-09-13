import type { LanguageCode } from '@echosphere/shared-types';

export const TRANSLATIONS = {
  en: {
    // Top Bar & Navigation
    classroom: 'Classroom',
    teacherDashboard: 'Teacher Dashboard',
    liveClassroom: 'Live Classroom',
    room: 'Room',
    leave: 'Leave',
    leaveClassroom: 'Leave classroom',
    bringAthenaIn: 'Bring Athena in',
    athenaPresent: 'Athena in room',
    athenaNotStarted: 'Athena not started',
    aiAssistant: 'AI Assistant',
    handRaise: 'Raise Hand',
    handLower: 'Lower Hand',
    mute: 'Mute mic',
    unmute: 'Unmute mic',
    muteAi: 'Mute AI',
    unmuteAi: 'Unmute AI',
    screenShare: 'Share Screen',
    stopScreenShare: 'Stop Sharing',
    
    // Status & Floor
    teacherSpeaking: 'Teacher is speaking',
    openFloor: 'Open floor',
    athenaSpeaking: 'Athena is speaking',
    waitingOnAthena: 'Waiting on Athena',
    listeningOnly: 'Listening only',
    aiMuted: 'AI muted',
    athenaReadyNotice: 'Athena is ready to help! Say "Athena" or ask a question.',
    athenaListeningNotice: 'Athena is listening only',
    absentNoticeTitle: 'Athena is not in the room yet.',
    absentNoticeTeacher: 'Press "Bring Athena in" above to start her. Live transcription runs through her, so nothing will be transcribed until she joins.',
    absentNoticeStudent: 'Live transcription runs through her, so nothing will appear here until your teacher brings her in. You can still be heard by everyone.',

    // Roster & Participants
    inTheRoom: 'In the room',
    teacher: 'Teacher',
    aiTeacher: 'AI teacher',
    student: 'Student',
    levelA: 'Level A (advanced)',
    levelB: 'Level B (intermediate)',
    levelC: 'Level C (beginner)',
    explanationLevel: 'Explanation level',

    // Transcript
    liveTranscript: 'Live transcript',
    turn: 'turn',
    turns: 'turns',
    nothingSpokenYet: 'Nothing spoken yet. The transcript fills in as people talk.',
    transcriptionStartsWhenJoined: 'Transcription starts when Athena joins the room.',
    unclearWho: 'unclear who',
    unclearWhoTooltip: 'Two people were speaking at close to the same volume — this attribution is a best guess, not a fact.',

    // Quiz
    quiz: 'Quiz',
    questionNofTotal: 'Question {n} of {total}',
    correct: 'Correct.',
    notQuite: 'Not quite.',
    answeredCorrectly: '{count} of {total} answered correctly',
    voiceAnswerPrompt: 'You can also answer out loud — say the option or its letter.',

    // Gaps & Interventions
    whoNeedsHelp: 'Who needs help',
    noGapsYet: 'No repeated misconceptions detected yet.',
    studentsCount: '{count} student(s)',
    athenaAddressedThis: 'Athena has addressed this.',
    quizTheseStudents: 'Quiz these students',
    aiHeldBack: 'AI held back',
    // Only defined for `en`: `t()` falls back to the English string for any
    // language that does not carry a key, so this needs no invented
    // translations to be safe to add.
    drawingFailed: 'Diagram not drawn',
    drawingFailedSpec: 'could not decide what to draw',
    drawingFailedExcalidraw: 'the drawing service did not respond',
    drawingFailedEmpty: 'came back empty',

    // Tabs & Tools
    tabClassroom: 'Classroom',
    tabWhiteboard: 'Whiteboard',
    tabChat: 'Live Chat',
    tabCatchup: 'Catch-up',
    tabWorkspace: 'Shared Workspace',
    tabControls: 'Lesson Controls',
    tabGaps: 'Gaps',
    tabTranscript: 'Transcript',
    tabQuizzes: 'Quizzes',
    tabNotes: 'Notes',
    tabReport: 'End Report',

    // Actions & Controls
    startQuiz: 'Start Quiz',
    explainNow: 'Explain to class',
    studentsMayInvoke: 'Students can call Athena',
    studentsMayNotInvoke: 'Floor closed to students',
    uploadMaterial: 'Upload lesson material',
    lessonMaterial: 'Lesson Material',
    endSession: 'End Session',
  },

  fr: {
    // Top Bar & Navigation
    classroom: 'Salle de classe',
    teacherDashboard: 'Tableau de bord Enseignant',
    liveClassroom: 'Classe en direct',
    room: 'Salle',
    leave: 'Quitter',
    leaveClassroom: 'Quitter la classe',
    bringAthenaIn: 'Faire entrer Athena',
    athenaPresent: 'Athena présente',
    athenaNotStarted: 'Athena non démarrée',
    aiAssistant: 'Assistant IA',
    handRaise: 'Lever la main',
    handLower: 'Baisser la main',
    mute: 'Couper le micro',
    unmute: 'Activer le micro',
    muteAi: 'Couper l’IA',
    unmuteAi: 'Réactiver l’IA',
    screenShare: 'Partager l’écran',
    stopScreenShare: 'Arrêter le partage',

    // Status & Floor
    teacherSpeaking: 'L’enseignant parle',
    openFloor: 'Parole libre',
    athenaSpeaking: 'Athena parle',
    waitingOnAthena: 'En attente d’Athena',
    listeningOnly: 'Écoute seule',
    aiMuted: 'IA en sourdine',
    athenaReadyNotice: 'Athena est prête à aider ! Dites « Athena » ou posez une question.',
    athenaListeningNotice: 'Athena est en écoute seule',
    absentNoticeTitle: 'Athena n’est pas encore dans la salle.',
    absentNoticeTeacher: 'Cliquez sur « Faire entrer Athena » ci-dessus pour la démarrer. La transcription en direct passe par elle.',
    absentNoticeStudent: 'La transcription en direct commence lorsqu’Athena rejoint la salle. Tout le monde peut vous entendre.',

    // Roster & Participants
    inTheRoom: 'Dans la salle',
    teacher: 'Enseignant',
    aiTeacher: 'Co-enseignante IA',
    student: 'Élève',
    levelA: 'Niveau A (avancé)',
    levelB: 'Niveau B (intermédiaire)',
    levelC: 'Niveau C (débutant)',
    explanationLevel: 'Niveau d’explication',

    // Transcript
    liveTranscript: 'Transcription en direct',
    turn: 'intervention',
    turns: 'interventions',
    nothingSpokenYet: 'Rien n’a encore été dit. La transcription s’affichera au fil des échanges.',
    transcriptionStartsWhenJoined: 'La transcription commence dès qu’Athena rejoint la salle.',
    unclearWho: 'locuteur incertain',
    unclearWhoTooltip: 'Deux personnes parlaient à un volume similaire — attribution estimée.',

    // Quiz
    quiz: 'Quiz interactif',
    questionNofTotal: 'Question {n} sur {total}',
    correct: 'Correct !',
    notQuite: 'Pas tout à fait.',
    answeredCorrectly: '{count} sur {total} ont répondu correctement',
    voiceAnswerPrompt: 'Vous pouvez aussi répondre à voix haute — dites l’option ou sa lettre.',

    // Gaps & Interventions
    whoNeedsHelp: 'Élèves ayant besoin d’aide',
    noGapsYet: 'Aucune confusion récurrente détectée pour l’instant.',
    studentsCount: '{count} élève(s)',
    athenaAddressedThis: 'Athena a déjà clarifié ce point.',
    quizTheseStudents: 'Tester ces élèves',
    aiHeldBack: 'IA retenue',

    // Tabs & Tools
    tabClassroom: 'Classe',
    tabWhiteboard: 'Tableau blanc',
    tabChat: 'Discussion',
    tabCatchup: 'Rattrapage',
    tabWorkspace: 'Espace partagé',
    tabControls: 'Contrôles',
    tabGaps: 'Difficultés',
    tabTranscript: 'Transcription',
    tabQuizzes: 'Quiz',
    tabNotes: 'Notes',
    tabReport: 'Rapport final',

    // Actions & Controls
    startQuiz: 'Lancer un quiz',
    explainNow: 'Expliquer à la classe',
    studentsMayInvoke: 'Les élèves peuvent appeler Athena',
    studentsMayNotInvoke: 'Parole fermée aux élèves',
    uploadMaterial: 'Importer le cours',
    lessonMaterial: 'Support de cours',
    endSession: 'Terminer la session',
  },

  es: {
    // Top Bar & Navigation
    classroom: 'Aula',
    teacherDashboard: 'Panel del Profesor',
    liveClassroom: 'Clase en vivo',
    room: 'Sala',
    leave: 'Salir',
    leaveClassroom: 'Salir del aula',
    bringAthenaIn: 'Traer a Athena',
    athenaPresent: 'Athena presente',
    athenaNotStarted: 'Athena no iniciada',
    aiAssistant: 'Asistente IA',
    handRaise: 'Levantar la mano',
    handLower: 'Bajar la mano',
    mute: 'Silenciar micrófono',
    unmute: 'Activar micrófono',
    muteAi: 'Silenciar IA',
    unmuteAi: 'Reactivar IA',
    screenShare: 'Compartir pantalla',
    stopScreenShare: 'Dejar de compartir',

    // Status & Floor
    teacherSpeaking: 'El profesor está hablando',
    openFloor: 'Turno libre',
    athenaSpeaking: 'Athena está hablando',
    waitingOnAthena: 'Esperando a Athena',
    listeningOnly: 'Solo escuchando',
    aiMuted: 'IA silenciada',
    athenaReadyNotice: '¡Athena está lista para ayudar! Di "Athena" o haz una pregunta.',
    athenaListeningNotice: 'Athena está solo escuchando',
    absentNoticeTitle: 'Athena aún no está en la sala.',
    absentNoticeTeacher: 'Presiona "Traer a Athena" arriba para iniciarla. La transcripción en vivo funciona a través de ella.',
    absentNoticeStudent: 'La transcripción comenzará cuando Athena se una a la sala. Todos pueden escucharte.',

    // Roster & Participants
    inTheRoom: 'En la sala',
    teacher: 'Profesor',
    aiTeacher: 'Co-profesora IA',
    student: 'Estudiante',
    levelA: 'Nivel A (avanzado)',
    levelB: 'Nivel B (intermedio)',
    levelC: 'Nivel C (principiante)',
    explanationLevel: 'Nivel de explicación',

    // Transcript
    liveTranscript: 'Transcripción en vivo',
    turn: 'intervención',
    turns: 'intervenciones',
    nothingSpokenYet: 'Aún no se ha hablado. La transcripción se llenará a medida que hablen.',
    transcriptionStartsWhenJoined: 'La transcripción comenzará cuando Athena se una.',
    unclearWho: 'hablante incierto',
    unclearWhoTooltip: 'Dos personas hablaron a un volumen similar — atribución estimada.',

    // Quiz
    quiz: 'Cuestionario',
    questionNofTotal: 'Pregunta {n} de {total}',
    correct: '¡Correcto!',
    notQuite: 'Casi, pero no.',
    answeredCorrectly: '{count} de {total} respondieron correctamente',
    voiceAnswerPrompt: 'También puedes responder en voz alta — di la opción o su letra.',

    // Gaps & Interventions
    whoNeedsHelp: 'Quién necesita ayuda',
    noGapsYet: 'No se han detectado confusiones repetidas todavía.',
    studentsCount: '{count} estudiante(s)',
    athenaAddressedThis: 'Athena ya ha abordado esto.',
    quizTheseStudents: 'Evaluar a estos estudiantes',
    aiHeldBack: 'IA retenida',

    // Tabs & Tools
    tabClassroom: 'Clase',
    tabWhiteboard: 'Pizarra',
    tabChat: 'Chat en vivo',
    tabCatchup: 'Ponerse al día',
    tabWorkspace: 'Espacio de trabajo',
    tabControls: 'Controles',
    tabGaps: 'Dificultades',
    tabTranscript: 'Transcripción',
    tabQuizzes: 'Cuestionarios',
    tabNotes: 'Notas',
    tabReport: 'Informe final',

    // Actions & Controls
    startQuiz: 'Iniciar cuestionario',
    explainNow: 'Explicar a la clase',
    studentsMayInvoke: 'Estudiantes pueden llamar a Athena',
    studentsMayNotInvoke: 'Turno cerrado a estudiantes',
    uploadMaterial: 'Subir material de clase',
    lessonMaterial: 'Material de clase',
    endSession: 'Finalizar clase',
  },

  hi: {
    // Top Bar & Navigation
    classroom: 'कक्षा',
    teacherDashboard: 'शिक्षक डैशबोर्ड',
    liveClassroom: 'लाइव कक्षा',
    room: 'कमरा',
    leave: 'छोड़ें',
    leaveClassroom: 'कक्षा से बाहर निकलें',
    bringAthenaIn: 'Athena को बुलाएं',
    athenaPresent: 'Athena मौजूद है',
    athenaNotStarted: 'Athena शुरू नहीं हुई',
    aiAssistant: 'AI सहायक',
    handRaise: 'हाथ उठाएं',
    handLower: 'हाथ नीचे करें',
    mute: 'माइक बंद करें',
    unmute: 'माइक चालू करें',
    muteAi: 'AI म्यूट करें',
    unmuteAi: 'AI अनम्यूट करें',
    screenShare: 'स्क्रीन साझा करें',
    stopScreenShare: 'साझाकरण रोकें',

    // Status & Floor
    teacherSpeaking: 'शिक्षक बोल रहे हैं',
    openFloor: 'खुला मंच',
    athenaSpeaking: 'Athena बोल रही है',
    waitingOnAthena: 'Athena की प्रतीक्षा है',
    listeningOnly: 'केवल सुन रही है',
    aiMuted: 'AI म्यूट है',
    athenaReadyNotice: 'Athena मदद के लिए तैयार है! "Athena" बोलें या प्रश्न पूछें।',
    athenaListeningNotice: 'Athena केवल सुन रही है',
    absentNoticeTitle: 'Athena अभी कमरे में नहीं है।',
    absentNoticeTeacher: 'उसे शुरू करने के लिए ऊपर "Athena को बुलाएं" दबाएं। लाइव ट्रांसक्रिप्शन उसी से चलता है।',
    absentNoticeStudent: 'जब Athena कमरे में जुड़ेगी तो ट्रांसक्रिप्शन शुरू होगा। आपकी आवाज सबको सुनाई दे रही है।',

    // Roster & Participants
    inTheRoom: 'कक्षा में उपस्थित',
    teacher: 'शिक्षक',
    aiTeacher: 'AI सह-शिक्षिका',
    student: 'छात्र',
    levelA: 'स्तर A (उन्नत)',
    levelB: 'स्तर B (मध्यम)',
    levelC: 'स्तर C (शुरुआती)',
    explanationLevel: 'विवरण का स्तर',

    // Transcript
    liveTranscript: 'लाइव ट्रांसक्रिप्ट',
    turn: 'टर्न',
    turns: 'टर्न्स',
    nothingSpokenYet: 'अभी कुछ नहीं बोला गया है। बातचीत शुरू होने पर ट्रांसक्रिप्ट दिखेगी।',
    transcriptionStartsWhenJoined: 'Athena के जुड़ते ही ट्रांसक्रिप्शन शुरू हो जाएगा।',
    unclearWho: 'वक्ता अस्पष्ट',
    unclearWhoTooltip: 'दो लोग लगभग एक ही आवाज़ में बोल रहे थे — यह एक अनुमानित पहचान है।',

    // Quiz
    quiz: 'प्रश्नोत्तरी (क्विज़)',
    questionNofTotal: 'प्रश्न {n} / {total}',
    correct: 'बिल्कुल सही!',
    notQuite: 'पूरी तरह सही नहीं।',
    answeredCorrectly: '{total} में से {count} ने सही उत्तर दिया',
    voiceAnswerPrompt: 'आप बोलकर भी उत्तर दे सकते हैं — विकल्प या उसका अक्षर बोलें।',

    // Gaps & Interventions
    whoNeedsHelp: 'किसे सहायता की आवश्यकता है',
    noGapsYet: 'अभी कोई दोहराई गई गलतफहमी नहीं मिली है।',
    studentsCount: '{count} छात्र',
    athenaAddressedThis: 'Athena ने इसे समझा दिया है।',
    quizTheseStudents: 'इन छात्रों का क्विज़ लें',
    aiHeldBack: 'AI रोकी गई',

    // Tabs & Tools
    tabClassroom: 'कक्षा',
    tabWhiteboard: 'व्हाइटबोर्ड',
    tabChat: 'लाइव चैट',
    tabCatchup: 'कैच-अप सत्र',
    tabWorkspace: 'साझा कार्यस्थान',
    tabControls: 'नियंत्रण',
    tabGaps: 'कमज़ोरियां',
    tabTranscript: 'ट्रांसक्रिप्ट',
    tabQuizzes: 'क्विज़',
    tabNotes: 'नोट्स',
    tabReport: 'अंतिम रिपोर्ट',

    // Actions & Controls
    startQuiz: 'क्विज़ शुरू करें',
    explainNow: 'कक्षा को समझाएं',
    studentsMayInvoke: 'छात्र Athena को बुला सकते हैं',
    studentsMayNotInvoke: 'छात्रों के लिए मंच बंद है',
    uploadMaterial: 'पाठ सामग्री अपलोड करें',
    lessonMaterial: 'पाठ सामग्री',
    endSession: 'कक्षा समाप्त करें',
  },

  de: {
    // Top Bar & Navigation
    classroom: 'Klassenzimmer',
    teacherDashboard: 'Lehrer-Dashboard',
    liveClassroom: 'Live-Klasse',
    room: 'Raum',
    leave: 'Verlassen',
    leaveClassroom: 'Klasse verlassen',
    bringAthenaIn: 'Athena hereinholen',
    athenaPresent: 'Athena anwesend',
    athenaNotStarted: 'Athena nicht gestartet',
    aiAssistant: 'KI-Assistent',
    handRaise: 'Hand heben',
    handLower: 'Hand senken',
    mute: 'Mikrofon stummschalten',
    unmute: 'Mikrofon einschalten',
    muteAi: 'KI stummschalten',
    unmuteAi: 'KI aktivieren',
    screenShare: 'Bildschirm teilen',
    stopScreenShare: 'Freigabe beenden',

    // Status & Floor
    teacherSpeaking: 'Lehrer spricht',
    openFloor: 'Offene Runde',
    athenaSpeaking: 'Athena spricht',
    waitingOnAthena: 'Warten auf Athena',
    listeningOnly: 'Nur Zuhören',
    aiMuted: 'KI stummgeschaltet',
    athenaReadyNotice: 'Athena ist bereit zu helfen! Sag „Athena“ oder stelle eine Frage.',
    athenaListeningNotice: 'Athena hört nur zu',
    absentNoticeTitle: 'Athena ist noch nicht im Raum.',
    absentNoticeTeacher: 'Drücke oben auf „Athena hereinholen“, um sie zu starten. Die Live-Transkription läuft über sie.',
    absentNoticeStudent: 'Die Transkription beginnt, sobald Athena beitritt. Jeder kann dich hören.',

    // Roster & Participants
    inTheRoom: 'Im Raum',
    teacher: 'Lehrer',
    aiTeacher: 'KI-Co-Lehrerin',
    student: 'Schüler',
    levelA: 'Stufe A (Fortgeschritten)',
    levelB: 'Stufe B (Mittelstufe)',
    levelC: 'Stufe C (Anfänger)',
    explanationLevel: 'Erklärungsstufe',

    // Transcript
    liveTranscript: 'Live-Transkript',
    turn: 'Beitrag',
    turns: 'Beiträge',
    nothingSpokenYet: 'Noch nichts gesprochen. Das Transkript füllt sich während des Gesprächs.',
    transcriptionStartsWhenJoined: 'Transkription startet, sobald Athena beitritt.',
    unclearWho: 'Sprecher unklar',
    unclearWhoTooltip: 'Zwei Personen sprachen in ähnlicher Lautstärke — geschätzte Zuordnung.',

    // Quiz
    quiz: 'Quiz',
    questionNofTotal: 'Frage {n} von {total}',
    correct: 'Richtig!',
    notQuite: 'Nicht ganz.',
    answeredCorrectly: '{count} von {total} richtig beantwortet',
    voiceAnswerPrompt: 'Du kannst auch laut antworten — nenne die Option oder ihren Buchstaben.',

    // Gaps & Interventions
    whoNeedsHelp: 'Wer braucht Hilfe',
    noGapsYet: 'Bisher keine wiederholten Missverständnisse erkannt.',
    studentsCount: '{count} Schüler',
    athenaAddressedThis: 'Athena hat dies bereits erklärt.',
    quizTheseStudents: 'Diese Schüler abfragen',
    aiHeldBack: 'KI zurückgehalten',

    // Tabs & Tools
    tabClassroom: 'Klasse',
    tabWhiteboard: 'Whiteboard',
    tabChat: 'Live-Chat',
    tabCatchup: 'Nachholunterricht',
    tabWorkspace: 'Gemeinsamer Arbeitsbereich',
    tabControls: 'Steuerung',
    tabGaps: 'Lernlücken',
    tabTranscript: 'Transkript',
    tabQuizzes: 'Quizze',
    tabNotes: 'Notizen',
    tabReport: 'Abschlussbericht',

    // Actions & Controls
    startQuiz: 'Quiz starten',
    explainNow: 'Klasse erklären',
    studentsMayInvoke: 'Schüler dürfen Athena aufrufen',
    studentsMayNotInvoke: 'Rederecht für Schüler gesperrt',
    uploadMaterial: 'Unterrichtsmaterial hochladen',
    lessonMaterial: 'Unterrichtsmaterial',
    endSession: 'Unterricht beenden',
  },

  ta: {
    // Top Bar & Navigation
    classroom: 'வகுப்பறை',
    teacherDashboard: 'ஆசிரியர் பலகை',
    liveClassroom: 'நேரலை வகுப்பறை',
    room: 'அறை',
    leave: 'வெளியேறு',
    leaveClassroom: 'வகுப்பறையிலிருந்து வெளியேறு',
    bringAthenaIn: 'Athena-வை அழைக்கவும்',
    athenaPresent: 'Athena உள்ளார்',
    athenaNotStarted: 'Athena தொடங்கப்படவில்லை',
    aiAssistant: 'AI உதவியாளர்',
    handRaise: 'கையை உயர்த்தவும்',
    handLower: 'கையை இறக்கவும்',
    mute: 'ஒலியை முடக்கு',
    unmute: 'ஒலியை இயக்கு',
    muteAi: 'AI முடக்கு',
    unmuteAi: 'AI இயக்கு',
    screenShare: 'திரையைப் பகிரவும்',
    stopScreenShare: 'பகிர்வை நிறுத்தவும்',

    // Status & Floor
    teacherSpeaking: 'ஆசிரியர் பேசுகிறார்',
    openFloor: 'திறந்த தளம்',
    athenaSpeaking: 'Athena பேசுகிறார்',
    waitingOnAthena: 'Athena-விற்காக காத்திருக்கிறது',
    listeningOnly: 'கேட்டல் மட்டும்',
    aiMuted: 'AI முடக்கப்பட்டது',
    athenaReadyNotice: 'Athena உதவ தயாராக உள்ளார்! "Athena" என்று சொல்லவும்.',
    athenaListeningNotice: 'Athena கேட்டுக் கொண்டிருக்கிறார்',
    absentNoticeTitle: 'Athena இன்னும் வகுப்பறைக்குள் வரவில்லை.',
    absentNoticeTeacher: 'Athena-வை தொடங்க மேலே உள்ள "Athena-வை அழைக்கவும்" பொத்தானை அழுத்தவும்.',
    absentNoticeStudent: 'Athena இணைந்ததும் உரைபெயர்ப்பு தொடங்கும். உங்கள் குரல் அனைவருக்கும் கேட்கிறது.',

    // Roster & Participants
    inTheRoom: 'வகுப்பில் உள்ளவர்கள்',
    teacher: 'ஆசிரியர்',
    aiTeacher: 'AI இணை ஆசிரியர்',
    student: 'மாணவர்',
    levelA: 'நிலை A (மேம்பட்ட)',
    levelB: 'நிலை B (இடைநிலை)',
    levelC: 'நிலை C (தொடக்கநிலை)',
    explanationLevel: 'விளக்க நிலை',

    // Transcript
    liveTranscript: 'நேரலை உரை',
    turn: 'பேச்சு',
    turns: 'பேச்சுகள்',
    nothingSpokenYet: 'இன்னும் எதுவும் பேசப்படவில்லை.',
    transcriptionStartsWhenJoined: 'Athena இணைந்ததும் உரை தொடங்கும்.',
    unclearWho: 'யார் என்று தெளிவாக இல்லை',
    unclearWhoTooltip: 'இருவர் ஒரே நேரத்தில் பேசினர்.',

    // Quiz
    quiz: 'வினாடி வினா',
    questionNofTotal: 'கேள்வி {n} / {total}',
    correct: 'மிகச் சரி!',
    notQuite: 'சரியாக இல்லை.',
    answeredCorrectly: '{total} இல் {count} பேர் சரியாக பதிலளித்தனர்',
    voiceAnswerPrompt: 'நீங்கள் குரல் மூலமாகவும் பதிலளிக்கலாம்.',

    // Gaps & Interventions
    whoNeedsHelp: 'யாருக்கு உதவி தேவை',
    noGapsYet: 'குழப்பங்கள் எதுவும் கண்டறியப்படவில்லை.',
    studentsCount: '{count} மாணவர்(கள்)',
    athenaAddressedThis: 'Athena இதை விளக்கியுள்ளார்.',
    quizTheseStudents: 'இவர்களிடம் வினா கேட்கவும்',
    aiHeldBack: 'AI நிறுத்தப்பட்டது',

    // Tabs & Tools
    tabClassroom: 'வகுப்பு',
    tabWhiteboard: 'வெள்ளைப்பலகை',
    tabChat: 'அரட்டை',
    tabCatchup: 'மீள்பார்வை',
    tabWorkspace: 'பகிர்வு தளம்',
    tabControls: 'கட்டுப்பாடுகள்',
    tabGaps: 'சிரமங்கள்',
    tabTranscript: 'உரை',
    tabQuizzes: 'வினாடி வினா',
    tabNotes: 'குறிப்புகள்',
    tabReport: 'இறுதி அறிக்கை',

    // Actions & Controls
    startQuiz: 'வினாடி வினாவைத் தொடங்கு',
    explainNow: 'வகுப்பிற்கு விளக்குங்கள்',
    studentsMayInvoke: 'மாணவர்கள் Athena-வை அழைக்கலாம்',
    studentsMayNotInvoke: 'மாணவர் பேச்சு முடக்கப்பட்டுள்ளது',
    uploadMaterial: 'பாடப்பொருளைப் பதிவேற்றவும்',
    lessonMaterial: 'பாடப்பொருள்',
    endSession: 'வகுப்பை முடிக்கவும்',
  },

  te: {
    // Top Bar & Navigation
    classroom: 'తరగతి గది',
    teacherDashboard: 'ఉపాధ్యాయుల డాష్‌బోర్డ్',
    liveClassroom: 'ప్రత్యక్ష తరగతి',
    room: 'గది',
    leave: 'నిష్క్రమించు',
    leaveClassroom: 'తరగతి నుండి నిష్క్రమించండి',
    bringAthenaIn: 'Athena ను పిలవండి',
    athenaPresent: 'Athena గదిలో ఉంది',
    athenaNotStarted: 'Athena ప్రారంభం కాలేదు',
    aiAssistant: 'AI సహాయకుడు',
    handRaise: 'చేయి ఎత్తండి',
    handLower: 'చేయి దించండి',
    mute: 'మైక్ మ్యూట్ చేయండి',
    unmute: 'మైక్ ఆన్ చేయండి',
    muteAi: 'AI మ్యూట్ చేయండి',
    unmuteAi: 'AI ఆన్ చేయండి',
    screenShare: 'స్క్రీన్ షేర్ చేయండి',
    stopScreenShare: 'షేరింగ్ ఆపండి',

    // Status & Floor
    teacherSpeaking: 'ఉపాధ్యాయుడు మాట్లాడుతున్నారు',
    openFloor: 'ఓపెన్ ఫ్లోర్',
    athenaSpeaking: 'Athena మాట్లాడుతోంది',
    waitingOnAthena: 'Athena కోసం వేచి ఉంది',
    listeningOnly: 'వినడం మాత్రమే',
    aiMuted: 'AI మ్యూట్ చేయబడింది',
    athenaReadyNotice: 'Athena సహాయం చేయడానికి సిద్ధంగా ఉంది! "Athena" అని పిలవండి.',
    athenaListeningNotice: 'Athena వింటోంది',
    absentNoticeTitle: 'Athena ఇంకా తరగతిలోకి రాలేదు.',
    absentNoticeTeacher: 'Athena ప్రారంభించడానికి పైన "Athena ను పిలవండి" నొక్కండి.',
    absentNoticeStudent: 'Athena చేరిన తర్వాత ట్రాన్స్‌క్రిప్షన్ ప్రారంభమవుతుంది.',

    // Roster & Participants
    inTheRoom: 'తరగతిలో ఉన్నవారు',
    teacher: 'ఉపాధ్యాయుడు',
    aiTeacher: 'AI సహ ఉపాధ్యాయిని',
    student: 'విద్యార్థి',
    levelA: 'స్థాయి A (ఉన్నత)',
    levelB: 'స్థాయి B (మధ్యస్థ)',
    levelC: 'స్థాయి C (ప్రారంభ)',
    explanationLevel: 'వివరణ స్థాయి',

    // Transcript
    liveTranscript: 'ప్రత్యక్ష ట్రాన్స్‌క్రిప్ట్',
    turn: 'సంభాషణ',
    turns: 'సంభాషణలు',
    nothingSpokenYet: 'ఇంకా ఎవరూ మాట్లాడలేదు.',
    transcriptionStartsWhenJoined: 'Athena చేరగానే ట్రాన్స్‌క్రిప్షన్ ప్రారంభమవుతుంది.',
    unclearWho: 'ఎవరో స్పష్టంగా లేదు',
    unclearWhoTooltip: 'ఇద్దరు ఒకేసారి మాట్లాడారు.',

    // Quiz
    quiz: 'క్విజ్',
    questionNofTotal: 'ప్రశ్న {n} / {total}',
    correct: 'సరిగ్గా చెప్పారు!',
    notQuite: 'సరైనది కాదు.',
    answeredCorrectly: '{total} లో {count} మంది సరైన సమాధానం ఇచ్చారు',
    voiceAnswerPrompt: 'మీరు మాట్లాడి కూడా సమాధానం ఇవ్వవచ్చు.',

    // Gaps & Interventions
    whoNeedsHelp: 'ఎవరికి సహాయం కావాలి',
    noGapsYet: 'ఎలాంటి సందేహాలు ఇంకా నమోదు కాలేదు.',
    studentsCount: '{count} విద్యార్థి(లు)',
    athenaAddressedThis: 'Athena దీన్ని వివరించింది.',
    quizTheseStudents: 'ఈ విద్యార్థులకు క్విజ్ ఇవ్వండి',
    aiHeldBack: 'AI ఆపబడింది',

    // Tabs & Tools
    tabClassroom: 'తరగతి',
    tabWhiteboard: 'వైట్‌బోర్డ్',
    tabChat: 'చాట్',
    tabCatchup: 'క్యాచ్-అప్',
    tabWorkspace: 'వర్క్‌స్పేస్',
    tabControls: 'నియంత్రణలు',
    tabGaps: 'సందేహాలు',
    tabTranscript: 'ట్రాన్స్‌క్రిప్ట్',
    tabQuizzes: 'క్విజ్‌లు',
    tabNotes: 'నోట్స్',
    tabReport: 'తుది నివేదిక',

    // Actions & Controls
    startQuiz: 'క్విజ్ ప్రారంభించండి',
    explainNow: 'తరగతికి వివరించండి',
    studentsMayInvoke: 'విద్యార్థులు Athena ను పిలవవచ్చు',
    studentsMayNotInvoke: 'విద్యార్థులకు ఫ్లోర్ మూసివేయబడింది',
    uploadMaterial: 'పాఠ్యాంశాలను అప్‌లోడ్ చేయండి',
    lessonMaterial: 'పాఠ్యాంశాలు',
    endSession: 'తరగతి ముగించండి',
  },
} as const;

export type TranslationKey = keyof typeof TRANSLATIONS.en;

export function t(
  key: TranslationKey,
  lang: LanguageCode = 'en',
  vars: Record<string, string | number> = {},
): string {
  const dictionary = (TRANSLATIONS[lang] ?? TRANSLATIONS.en) as Record<string, string>;
  let text = dictionary[key] ?? TRANSLATIONS.en[key] ?? key;

  for (const [vKey, val] of Object.entries(vars)) {
    text = text.replaceAll(`{${vKey}}`, String(val));
  }

  return text;
}
