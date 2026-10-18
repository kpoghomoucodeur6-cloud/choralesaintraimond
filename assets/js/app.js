(function () {
  "use strict";

  const CATEGORIES = [
    "Chant d'entrée", "Kyrie", "Gloria", "Psaume", "Alléluia", "Offertoire",
    "Sanctus", "Agnus Dei", "Communion", "Chant de sortie", "Chants mariaux", "Autres chants"
  ];
  const VOICE_PARTS = [
    { id: "soprano", label: "Soprano" },
    { id: "alto", label: "Alto" },
    { id: "tenor", label: "Ténor" },
    { id: "bass", label: "Basse" }
  ];
  const MEMBER_VOICES = VOICE_PARTS.concat([{ id: "solo", label: "Solo" }]);
  const MASS_TYPES = [
    { id: "sunday", label: "Messe dominicale" },
    { id: "christmas", label: "Noël" },
    { id: "easter", label: "Pâques" },
    { id: "wedding", label: "Mariage" },
    { id: "baptism", label: "Baptême" },
    { id: "funeral", label: "Funérailles" },
    { id: "patronal", label: "Fête patronale" },
    { id: "other", label: "Autre" }
  ];
  const MASS_STEPS = [
    { id: "entrance", label: "Chant d’entrée" },
    { id: "kyrie", label: "Kyrie" },
    { id: "gloria", label: "Gloria" },
    { id: "psalm", label: "Psaume responsorial" },
    { id: "gospel_acclamation", label: "Alléluia ou acclamation avant l’Évangile" },
    { id: "gospel_homily", label: "Évangile et homélie", noSong: true },
    { id: "creed", label: "Credo" },
    { id: "intercessions", label: "Prière universelle" },
    { id: "offertory", label: "Offertoire" },
    { id: "sanctus", label: "Sanctus" },
    { id: "consecration_acclamation", label: "Acclamation après la consécration" },
    { id: "our_father", label: "Pater (Notre Père)" },
    { id: "sign_of_peace", label: "Baiser de paix" },
    { id: "agnus_dei", label: "Agnus Dei" },
    { id: "communion", label: "Communion" },
    { id: "thanksgiving", label: "Action de grâce" },
    { id: "exit", label: "Chant de sortie" }
  ];
  const PAGE_NAMES = {
    dashboard: "Tableau de bord",
    library: "Bibliothèque musicale",
    favorites: "Mes favoris",
    categories: "Catégories",
    programs: "Programme des messes",
    manage: "Gestion des chants",
    members: "Membres"
  };
  const ADMIN_PAGES = ["manage", "members"];
  const BUCKET = "chora-files";
  const MAX_PDF = 3 * 1024 * 1024;
  const MAX_AUDIO = 5 * 1024 * 1024;
  const LEGACY_KEY = "chora-library-v1";
  const LEGACY_DONE_KEY = "chora-legacy-imported";
  const config = window.CHORA_CONFIG || {};

  const $ = function (id) { return document.getElementById(id); };
  const content = $("app-content");
  const modalBackdrop = $("modal-backdrop");
  const modal = $("modal");
  const toastRegion = $("toast-region");
  const authScreen = $("auth-screen");
  const appShell = $("app-shell");

  let client = null;
  let user = null;
  let profile = null;
  let songs = [];
  let members = null;
  let massPrograms = [];
  let programsLoaded = false;
  let programLoadError = false;
  let programSearchTerm = "";
  let programDraft = null;
  let programPickerStep = null;
  let programPickerReplaceSongId = null;
  let programPickerSearch = "";
  let selectedProgram = null;
  let currentPage = "dashboard";
  let searchTerm = "";
  let categoryFilter = "";
  let sortBy = "recent";
  let authMode = "signin";
  let recoveryPending = false;
  let importing = false;

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function isAdmin() { return !!profile && profile.role === "admin"; }
  function memberVoiceLabel(value) {
    const voice = MEMBER_VOICES.find(function (item) { return item.id === value; });
    return voice ? voice.label : "Non renseignée";
  }

  function notify(message, isError) {
    const toast = document.createElement("div");
    toast.className = "toast" + (isError ? " error" : "");
    toast.textContent = message;
    toastRegion.appendChild(toast);
    window.setTimeout(function () { toast.remove(); }, 5000);
  }

  function friendlyError(error, fallback) {
    const message = error && error.message ? String(error.message) : "";
    if (/row-level security|permission denied|not authorized/i.test(message)) return "Action réservée aux administrateurs.";
    if (/Failed to fetch|NetworkError|network/i.test(message)) return "Connexion impossible. Vérifiez votre accès Internet.";
    if (/relation .* does not exist|schema cache/i.test(message)) return "La base de données n'est pas encore configurée (script supabase/schema.sql).";
    return message ? fallback + " (" + message + ")" : fallback;
  }

  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" }).format(date);
  }

  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, function (c) {
      return (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16);
    });
  }

  /* ---------- Affichage général ---------- */

  function showAuth() {
    appShell.hidden = true;
    authScreen.hidden = false;
    document.body.style.overflow = "";
  }

  function showApp() {
    authScreen.hidden = true;
    appShell.hidden = false;
  }

  function closeMenu() {
    $("sidebar").classList.remove("open");
    $("mobile-overlay").classList.remove("open");
  }

  function applyRole() {
    const admin = isAdmin();
    document.querySelectorAll(".admin-only").forEach(function (item) { item.hidden = !admin; });
    const name = (profile && profile.full_name) || (user && user.email) || "Membre";
    $("user-name").textContent = name;
    $("user-email").textContent = (user && user.email) || "";
    $("user-role").textContent = admin ? "Administrateur" : "Choriste";
    $("user-role").classList.toggle("admin", admin);
    $("topbar-role").textContent = admin ? "Administrateur" : "Choriste";
    $("topbar-name").textContent = name;
    $("topbar-voice").textContent = profile && profile.voice_part ? memberVoiceLabel(profile.voice_part) : "Voix non renseignée";
    const initials = name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(function (part) {
      return Array.from(part)[0].toLocaleUpperCase("fr");
    }).join("");
    $("topbar-avatar").textContent = initials || "M";
    $("topbar-avatar").setAttribute("aria-label", "Profil de " + name);
    $("topbar-avatar").classList.toggle("admin", admin);
  }

  function resetState() {
    user = null;
    profile = null;
    songs = [];
    members = null;
    massPrograms = [];
    programsLoaded = false;
    programLoadError = false;
    programDraft = null;
    programPickerStep = null;
    programPickerReplaceSongId = null;
    selectedProgram = null;
    searchTerm = "";
    categoryFilter = "";
    currentPage = "dashboard";
    closeModal();
    closeMenu();
    content.innerHTML = "";
  }

  /* ---------- Authentification ---------- */

  function setAuthMessage(message, isError) {
    const box = $("auth-message");
    box.hidden = !message;
    box.textContent = message || "";
    box.classList.toggle("error", !!isError);
  }

  function setAuthMode(mode) {
    authMode = mode;
    const signup = mode === "signup";
    document.querySelectorAll(".auth-tab").forEach(function (tab) {
      tab.classList.toggle("active", tab.dataset.authMode === mode);
    });
    $("auth-name-field").hidden = !signup;
    $("auth-voice-field").hidden = !signup;
    $("auth-voice").required = signup;
    $("auth-submit").textContent = signup ? "Créer mon compte" : "Se connecter";
    $("auth-password").autocomplete = signup ? "new-password" : "current-password";
    $("auth-forgot").hidden = signup;
    $("auth-subtitle").textContent = signup
      ? "Créez votre compte de choriste pour accéder au répertoire."
      : "Connectez-vous pour accéder au répertoire de la chorale.";
    setAuthMessage("");
  }

  function redirectUrl() {
    return /^https?:$/.test(window.location.protocol) ? window.location.origin + window.location.pathname : undefined;
  }

  function authErrorMessage(error) {
    const message = error && error.message ? error.message : "";
    if (/invalid login credentials/i.test(message)) return "E-mail ou mot de passe incorrect.";
    if (/email not confirmed/i.test(message)) return "Adresse e-mail non confirmée. Ouvrez le lien reçu par e-mail, puis reconnectez-vous.";
    if (/password should be at least|weak password/i.test(message)) return "Mot de passe trop faible : utilisez au moins 8 caractères.";
    if (/rate limit|too many/i.test(message)) return "Trop de tentatives. Patientez quelques minutes puis réessayez.";
    if (/invalid.*email|unable to validate email/i.test(message)) return "Adresse e-mail invalide.";
    if (/Failed to fetch|network/i.test(message)) return "Connexion impossible. Vérifiez votre accès Internet.";
    return "Opération impossible pour le moment. Réessayez.";
  }

  async function submitAuth(event) {
    event.preventDefault();
    const email = $("auth-email").value.trim();
    const password = $("auth-password").value;
    const name = $("auth-name").value.trim();
    const voicePart = $("auth-voice").value;
    const submit = $("auth-submit");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setAuthMessage("Saisissez une adresse e-mail valide.", true); return; }
    if (authMode === "signup" && password.length < 8) { setAuthMessage("Le mot de passe doit contenir au moins 8 caractères.", true); return; }
    if (authMode === "signup" && !MEMBER_VOICES.some(function (voice) { return voice.id === voicePart; })) { setAuthMessage("Choisissez votre voix ou pupitre.", true); return; }
    if (!password) { setAuthMessage("Saisissez votre mot de passe.", true); return; }
    submit.disabled = true;
    setAuthMessage("");
    try {
      if (authMode === "signin") {
        const result = await client.auth.signInWithPassword({ email: email, password: password });
        if (result.error) throw result.error;
      } else {
        const result = await client.auth.signUp({
          email: email,
          password: password,
          options: { data: { full_name: name, voice_part: voicePart }, emailRedirectTo: redirectUrl() }
        });
        if (result.error) throw result.error;
        if (!result.data.session) {
          $("auth-password").value = "";
          setAuthMessage("Compte créé. Un e-mail de confirmation vient de vous être envoyé : cliquez sur le lien, puis connectez-vous.", false);
        }
      }
    } catch (error) {
      setAuthMessage(authErrorMessage(error), true);
    } finally {
      submit.disabled = false;
    }
  }

  async function forgotPassword() {
    const email = $("auth-email").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setAuthMessage("Saisissez d'abord votre adresse e-mail.", true); return; }
    const result = await client.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl() });
    if (result.error) { setAuthMessage(authErrorMessage(result.error), true); return; }
    setAuthMessage("Si un compte existe pour cette adresse, un e-mail de réinitialisation vient d'être envoyé.", false);
  }

  function openPasswordForm() {
    openModal("Nouveau mot de passe", "Choisissez un nouveau mot de passe pour votre compte.", '<form class="modal-body" id="password-form" novalidate><div class="form-field"><label for="new-password">Nouveau mot de passe</label><input class="field" id="new-password" type="password" minlength="8" maxlength="72" autocomplete="new-password" required></div><div class="modal-actions"><button type="submit" class="btn btn-primary">Enregistrer</button></div></form>');
    $("password-form").addEventListener("submit", async function (event) {
      event.preventDefault();
      const value = $("new-password").value;
      if (value.length < 8) { notify("Le mot de passe doit contenir au moins 8 caractères.", true); return; }
      const result = await client.auth.updateUser({ password: value });
      if (result.error) { notify(authErrorMessage(result.error), true); return; }
      closeModal();
      notify("Votre mot de passe a été modifié.");
    });
  }

  async function startSession(sessionUser) {
    if (user && user.id === sessionUser.id) return;
    user = sessionUser;
    profile = null;
    const result = await client.from("profiles").select("id,email,full_name,role,voice_part").eq("id", sessionUser.id).maybeSingle();
    if (user !== sessionUser) return;
    if (result.error) notify(friendlyError(result.error, "Impossible de lire votre profil."), true);
    profile = result.data || { id: sessionUser.id, email: sessionUser.email, full_name: "", role: "choriste", voice_part: sessionUser.user_metadata && sessionUser.user_metadata.voice_part };
    applyRole();
    showApp();
    content.innerHTML = '<div class="empty-state"><h3>Chargement…</h3></div>';
    await loadSongs();
    if (user !== sessionUser) return;
    navigate("dashboard");
  }

  async function handleAuthChange(session) {
    if (!session) {
      if (user) resetState();
      showAuth();
      return;
    }
    await startSession(session.user);
    if (recoveryPending) {
      recoveryPending = false;
      openPasswordForm();
    }
  }

  async function signOut() {
    const result = await client.auth.signOut();
    if (result.error) notify("Déconnexion impossible. Réessayez.", true);
  }

  /* ---------- Données ---------- */

  function mapSong(row, favorites) {
    return {
      id: row.id,
      title: row.title,
      category: row.category,
      author: row.author || "",
      duration: row.duration || "",
      lyrics: row.lyrics || "",
      createdAt: row.created_at,
      favorite: favorites.has(row.id),
      pdf: row.pdf_path ? { path: row.pdf_path, name: row.pdf_name || "partition.pdf" } : null,
      audio: row.audio_path ? { path: row.audio_path, name: row.audio_name || "enregistrement" } : null,
      voices: VOICE_PARTS.reduce(function (parts, voice) {
        const audioPath = row[voice.id + "_audio_path"];
        parts[voice.id] = {
          audio: audioPath ? { path: audioPath, name: row[voice.id + "_audio_name"] || voice.label + " — enregistrement" } : null
        };
        return parts;
      }, {})
    };
  }

  async function loadSongs() {
    const responses = await Promise.all([
      client.from("songs").select("*").order("created_at", { ascending: false }),
      client.from("favorites").select("song_id")
    ]);
    const songsResult = responses[0];
    const favoritesResult = responses[1];
    if (songsResult.error || favoritesResult.error) {
      notify(friendlyError(songsResult.error || favoritesResult.error, "Impossible de charger les chants."), true);
      return false;
    }
    const favorites = new Set(favoritesResult.data.map(function (row) { return row.song_id; }));
    songs = songsResult.data.map(function (row) { return mapSong(row, favorites); });
    return true;
  }

  async function loadMembers() {
    const result = await client.from("profiles").select("id,email,full_name,role,voice_part,created_at").order("created_at", { ascending: false });
    if (result.error) {
      notify(friendlyError(result.error, "Impossible de charger les membres."), true);
      members = [];
    } else {
      members = result.data;
    }
    if (currentPage === "members") render();
  }

  async function loadMassPrograms() {
    const sessionUser = user;
    programsLoaded = false;
    programLoadError = false;
    render();
    const results = await Promise.all([
      client.from("mass_programs").select("*").order("celebration_at", { ascending: true }),
      client.from("mass_program_steps").select("*").order("position", { ascending: true }),
      client.from("mass_program_step_songs").select("*").order("position", { ascending: true })
    ]);
    if (user !== sessionUser) return false;
    const programsResult = results[0];
    const stepsResult = results[1];
    const stepSongsResult = results[2];
    if (programsResult.error || stepsResult.error || stepSongsResult.error) {
      notify(friendlyError(programsResult.error || stepsResult.error || stepSongsResult.error, "Impossible de charger les programmes des messes."), true);
      massPrograms = [];
      programLoadError = true;
      programsLoaded = true;
      render();
      return false;
    }
    massPrograms = programsResult.data.map(function (row) {
      return Object.assign({}, row, {
        steps: stepsResult.data.filter(function (step) { return step.program_id === row.id; })
          .sort(function (a, b) { return a.position - b.position; })
          .map(function (step) {
            const linkedSongIds = stepSongsResult.data.filter(function (link) { return link.step_id === step.id; })
              .sort(function (a, b) { return a.position - b.position; })
              .map(function (link) { return link.song_id; });
            const songIds = linkedSongIds.length ? linkedSongIds : (step.song_id ? [step.song_id] : []);
            return Object.assign({}, step, {
              song_ids: songIds,
              songs: songIds.map(function (songId) {
                return songs.find(function (song) { return song.id === songId; }) || null;
              }).filter(Boolean)
            });
          })
      });
    });
    programsLoaded = true;
    render();
    return true;
  }

  async function toggleFavorite(song) {
    const result = song.favorite
      ? await client.from("favorites").delete().eq("song_id", song.id).eq("user_id", user.id)
      : await client.from("favorites").insert({ song_id: song.id });
    if (result.error) {
      notify(friendlyError(result.error, "Impossible de modifier vos favoris."), true);
      return;
    }
    song.favorite = !song.favorite;
    render();
  }

  async function changeRole(memberId) {
    const member = (members || []).find(function (item) { return item.id === memberId; });
    if (!member || member.id === user.id) return;
    const nextRole = member.role === "admin" ? "choriste" : "admin";
    const label = nextRole === "admin" ? "nommer administrateur" : "repasser en choriste";
    if (!window.confirm("Voulez-vous " + label + " " + (member.full_name || member.email) + " ?")) return;
    const result = await client.from("profiles").update({ role: nextRole }).eq("id", memberId).select("id");
    if (result.error || !result.data || !result.data.length) {
      notify(friendlyError(result.error, "Changement de rôle refusé."), true);
      return;
    }
    member.role = nextRole;
    render();
    notify("Le rôle a été mis à jour.");
  }

  /* ---------- Rendu ---------- */

  function navigate(page, category) {
    if (!PAGE_NAMES[page]) return;
    if (ADMIN_PAGES.indexOf(page) !== -1 && !isAdmin()) page = "dashboard";
    currentPage = page;
    if (typeof category !== "undefined") categoryFilter = category;
    $("page-crumb").textContent = PAGE_NAMES[page];
    document.querySelectorAll(".nav-link[data-page], .mobile-action-bar [data-page]").forEach(function (link) {
      const active = link.dataset.page === page;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    closeMenu();
    render();
    content.classList.remove("page-transition");
    void content.offsetWidth;
    content.classList.add("page-transition");
    window.setTimeout(function () { content.classList.remove("page-transition"); }, 380);
    if (page === "members") loadMembers();
    if (page === "programs") loadMassPrograms();
  }

  function pageHeading(eyebrow, title, subtitle, action) {
    return '<div class="page-heading"><div><p class="eyebrow">' + eyebrow + '</p><h1>' + title + '</h1><p class="page-subtitle">' + subtitle + '</p></div>' + (action || "") + '</div>';
  }

  function addButton() {
    return isAdmin() ? '<button class="btn btn-primary" data-action="new-song">＋ Ajouter un chant</button>' : "";
  }

  function songActions(song) {
    const label = song.favorite ? "Retirer des favoris" : "Ajouter aux favoris";
    return '<div class="song-actions">' +
      '<button class="icon-button favorite" data-action="favorite" data-id="' + escapeHtml(song.id) + '" aria-label="' + label + '" title="' + label + '">' + (song.favorite ? "♥" : "♡") + '</button>' +
      '<button class="icon-button" data-action="details" data-id="' + escapeHtml(song.id) + '" aria-label="Voir le chant" title="Voir le chant">↗</button>' +
      '</div>';
  }

  function fileIndicators(song) {
    const indicators = [];
    if (song.pdf) indicators.push("<span>PDF</span>");
    if (song.audio) indicators.push("<span>Audio</span>");
    VOICE_PARTS.forEach(function (voice) {
      const part = song.voices && song.voices[voice.id];
      if (part && part.audio) indicators.push("<span>" + escapeHtml(voice.label) + " audio</span>");
    });
    return '<div class="file-indicators">' + (indicators.join("") || "—") + '</div>';
  }

  function emptyState(title, message, withAdd) {
    return '<div class="empty-state"><div class="empty-icon" aria-hidden="true">♫</div><h3>' + title + '</h3><p>' + message + '</p>' +
      (withAdd && isAdmin() ? '<button class="btn btn-primary" data-action="new-song">＋ Ajouter un chant</button>' : "") + '</div>';
  }

  function recentSongs(list) {
    if (!list.length) {
      return emptyState("Le répertoire est encore vide", isAdmin() ? "Ajoutez les premiers chants de la chorale pour les partager avec tous les membres." : "Les administrateurs de la chorale n'ont pas encore ajouté de chants.", true);
    }
    return '<div class="song-list">' + list.map(function (song) {
      return '<div class="song-row"><div class="song-art" aria-hidden="true">♫</div><div class="song-info"><button class="song-title" data-action="details" data-id="' + escapeHtml(song.id) + '">' + escapeHtml(song.title) + '</button><p class="song-meta">' + escapeHtml(song.category) + (song.author ? " · " + escapeHtml(song.author) : "") + '</p></div>' + songActions(song) + '</div>';
    }).join("") + '</div>';
  }

  function readLegacySongs() {
    if (!isAdmin() || localStorage.getItem(LEGACY_DONE_KEY) === "1") return [];
    try {
      const parsed = JSON.parse(localStorage.getItem(LEGACY_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.map(cleanImported).filter(Boolean) : [];
    } catch (error) {
      return [];
    }
  }

  function renderDashboard() {
    const total = songs.length;
    const categoriesUsed = new Set(songs.map(function (song) { return song.category; })).size;
    const pdfs = songs.filter(function (song) { return !!song.pdf; }).length;
    const favorites = songs.filter(function (song) { return song.favorite; }).length;
    const newest = songs.slice(0, 5);
    const legacy = readLegacySongs();
    const firstName = ((profile && profile.full_name) || "").split(" ")[0];
    const legacyNotice = legacy.length
      ? '<div class="notice"><div><strong>' + legacy.length + ' chant(s) de l\'ancienne version locale détecté(s) sur cet appareil.</strong><p>Importez-les dans la bibliothèque partagée pour que tous les membres puissent y accéder.</p></div><button class="btn btn-primary btn-small" data-action="import-legacy">Importer</button></div>'
      : "";
    return pageHeading("VOTRE RÉPERTOIRE EN UN COUP D’ŒIL", "La musique rassemble.", "Retrouvez les chants de votre chorale, partagés entre tous les membres.", addButton()) +
      legacyNotice +
      '<section class="welcome-panel"><div><p class="eyebrow" style="color:#dfc779">BIENVENUE' + (firstName ? ", " + escapeHtml(firstName.toUpperCase()) : "") + '</p><h2>Chaque chant a sa place.</h2><p>Votre répertoire liturgique, organisé simplement pour accompagner la prière et la vie de votre chorale.</p></div><div class="welcome-motif" aria-hidden="true">♫</div></section>' +
      '<div class="stats-grid"><article class="stat-card"><div class="stat-top">Chants enregistrés <span class="stat-icon">♫</span></div><p class="stat-value">' + total + '</p></article>' +
      '<article class="stat-card"><div class="stat-top">Catégories utilisées <span class="stat-icon">▦</span></div><p class="stat-value">' + categoriesUsed + '</p></article>' +
      '<article class="stat-card"><div class="stat-top">Partitions disponibles <span class="stat-icon">▤</span></div><p class="stat-value">' + pdfs + '</p></article>' +
      '<article class="stat-card"><div class="stat-top">Mes favoris <span class="stat-icon">♡</span></div><p class="stat-value">' + favorites + '</p></article></div>' +
      '<section class="section-card"><div class="section-header"><h2>Ajoutés récemment</h2><button class="text-link" data-page="library">Voir toute la bibliothèque →</button></div>' + recentSongs(newest) + '</section>';
  }

  function filteredSongs() {
    const query = searchTerm.trim().toLocaleLowerCase("fr");
    const result = songs.filter(function (song) {
      const matchesQuery = !query || [song.title, song.author, song.category, song.lyrics].some(function (value) {
        return value.toLocaleLowerCase("fr").includes(query);
      });
      const matchesCategory = !categoryFilter || song.category === categoryFilter;
      const matchesFavorite = currentPage !== "favorites" || song.favorite;
      return matchesQuery && matchesCategory && matchesFavorite;
    });
    result.sort(function (a, b) {
      if (sortBy === "title") return a.title.localeCompare(b.title, "fr");
      if (sortBy === "category") return a.category.localeCompare(b.category, "fr") || a.title.localeCompare(b.title, "fr");
      return b.createdAt.localeCompare(a.createdAt);
    });
    return result;
  }

  function renderLibrary() {
    const isManage = currentPage === "manage";
    const isFavorites = currentPage === "favorites";
    const headingTitle = isManage ? "Gestion des chants" : isFavorites ? "Vos chants favoris" : "Bibliothèque musicale";
    const subtitle = isManage ? "Ajoutez, modifiez et organisez le répertoire de votre chorale." :
      isFavorites ? "Retrouvez rapidement les chants que vous aimez." : "Parcourez et retrouvez facilement tous les chants du répertoire.";
    const result = filteredSongs();
    const filterOptions = CATEGORIES.map(function (category) {
      return '<option value="' + escapeHtml(category) + '"' + (categoryFilter === category ? " selected" : "") + '>' + escapeHtml(category) + '</option>';
    }).join("");
    let rows;
    if (result.length) {
      rows = '<div class="table-wrap"><table class="song-table"><thead><tr><th>Titre du chant</th><th>Catégorie</th><th>Auteur / compositeur</th><th>Durée</th><th>Documents</th><th>Ajouté le</th><th>Actions</th></tr></thead><tbody>' +
        result.map(function (song) {
          return '<tr><td><button class="table-title" data-action="details" data-id="' + escapeHtml(song.id) + '">' + escapeHtml(song.title) + '</button></td><td><span class="pill">' + escapeHtml(song.category) + '</span></td><td>' + (escapeHtml(song.author) || "—") + '</td><td>' + (escapeHtml(song.duration) || "—") + '</td><td>' + fileIndicators(song) + '</td><td>' + formatDate(song.createdAt) + '</td><td><div class="row-action">' +
            '<button class="icon-button" data-action="favorite" data-id="' + escapeHtml(song.id) + '" aria-label="Favori">' + (song.favorite ? "♥" : "♡") + '</button>' +
            '<button class="icon-button" data-action="details" data-id="' + escapeHtml(song.id) + '" aria-label="Voir">↗</button>' +
            (isManage ? '<button class="icon-button" data-action="edit" data-id="' + escapeHtml(song.id) + '" aria-label="Modifier">✎</button><button class="icon-button" data-action="delete" data-id="' + escapeHtml(song.id) + '" aria-label="Supprimer">⌫</button>' : "") +
            '</div></td></tr>';
        }).join("") + '</tbody></table></div>';
    } else {
      rows = emptyState(isFavorites ? "Aucun favori pour le moment" : "Aucun chant trouvé", isFavorites ? "Appuyez sur le cœur d’un chant pour l’ajouter à vos favoris." : "Essayez une autre recherche ou revenez plus tard.", !isFavorites);
    }
    return pageHeading(isFavorites ? "SÉLECTION PERSONNELLE" : "VOTRE RÉPERTOIRE", headingTitle, subtitle, isManage ? addButton() : "") +
      '<section class="section-card"><div class="library-toolbar"><label class="search-wrap"><span aria-hidden="true">⌕</span><input id="song-search" class="field" type="search" placeholder="Rechercher par titre, auteur, paroles…" value="' + escapeHtml(searchTerm) + '" aria-label="Rechercher dans les chants"></label>' +
      '<select id="category-filter" class="select-field" aria-label="Filtrer par catégorie"><option value="">Toutes les catégories</option>' + filterOptions + '</select>' +
      '<select id="sort-filter" class="select-field" aria-label="Trier les chants"><option value="recent"' + (sortBy === "recent" ? " selected" : "") + '>Plus récents</option><option value="title"' + (sortBy === "title" ? " selected" : "") + '>Titre A–Z</option><option value="category"' + (sortBy === "category" ? " selected" : "") + '>Catégorie</option></select></div>' +
      (categoryFilter ? '<div style="padding:12px 20px 0"><button class="text-link" data-action="clear-category">← Toutes les catégories</button></div>' : "") + rows + '</section>';
  }

  function renderCategories() {
    return pageHeading("ORGANISEZ VOTRE RÉPERTOIRE", "Catégories liturgiques", "Explorez les chants selon les temps et les moments de la célébration.") +
      '<div class="category-grid">' + CATEGORIES.map(function (category, index) {
        const count = songs.filter(function (song) { return song.category === category; }).length;
        return '<button class="category-card" data-action="open-category" data-category="' + escapeHtml(category) + '"><span class="category-symbol" aria-hidden="true">' + ["♩", "♪", "♫", "♬"][index % 4] + '</span><p class="category-name">' + escapeHtml(category) + '</p><p class="category-total">' + count + (count > 1 ? " chants" : " chant") + '</p></button>';
      }).join("") + '</div>';
  }

  function renderMembers() {
    let body;
    if (members === null) {
      body = '<div class="empty-state"><h3>Chargement…</h3></div>';
    } else if (!members.length) {
      body = emptyState("Aucun membre", "Les membres inscrits apparaîtront ici.", false);
    } else {
      body = '<div class="table-wrap"><table class="song-table"><thead><tr><th>Nom</th><th>E-mail</th><th>Voix / pupitre</th><th>Rôle</th><th>Inscrit le</th><th>Action</th></tr></thead><tbody>' +
        members.map(function (member) {
          const self = member.id === user.id;
          return '<tr><td>' + (escapeHtml(member.full_name) || "—") + (self ? " (vous)" : "") + '</td><td>' + escapeHtml(member.email) + '</td><td>' + escapeHtml(memberVoiceLabel(member.voice_part)) + '</td><td><span class="pill">' + (member.role === "admin" ? "Administrateur" : "Choriste") + '</span></td><td>' + formatDate(member.created_at) + '</td><td>' +
            (self ? "—" : '<button class="btn btn-secondary btn-small" data-action="toggle-role" data-id="' + escapeHtml(member.id) + '">' + (member.role === "admin" ? "Repasser choriste" : "Nommer administrateur") + '</button>') + '</td></tr>';
        }).join("") + '</tbody></table></div>';
    }
    return pageHeading("ADMINISTRATION", "Membres de la chorale", "Les nouveaux comptes sont des choristes. Vous pouvez nommer d'autres administrateurs.") +
      '<section class="section-card">' + body + '</section>';
  }

  function emptyProgramSteps() {
    return MASS_STEPS.map(function (step, index) {
      return { stage_key: step.id, position: index + 1, is_visible: true, song_ids: [], note: "" };
    });
  }

  function dateTimeInputValue(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  function formatCelebrationDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Date à préciser" : new Intl.DateTimeFormat("fr-FR", {
      weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit"
    }).format(date);
  }

  function massTypeLabel(value) {
    const type = MASS_TYPES.find(function (item) { return item.id === value; });
    return type ? type.label : "Autre célébration";
  }

  function massProgramCard(program) {
    const visibleSteps = (program.steps || []).filter(function (step) { return step.is_visible; });
    const selectedSongs = visibleSteps.reduce(function (count, step) { return count + (step.song_ids || []).length; }, 0);
    return '<article class="mass-program-card"><div class="mass-program-date"><span aria-hidden="true">✦</span><div><strong>' + escapeHtml(formatCelebrationDate(program.celebration_at)) + '</strong><span>' + escapeHtml(massTypeLabel(program.mass_type)) + '</span></div></div>' +
      '<h3>' + escapeHtml(program.celebration_name) + '</h3><p class="mass-program-meta">' + escapeHtml(program.parish_name) + ' · ' + escapeHtml(program.choir_name) + '</p>' +
      '<div class="mass-program-summary"><span>♫ ' + selectedSongs + ' chant(s)</span><span>' + visibleSteps.length + ' étape(s)</span></div>' +
      '<div class="mass-program-actions"><button class="btn btn-secondary btn-small" data-action="view-program" data-id="' + escapeHtml(program.id) + '">Consulter</button>' +
      (isAdmin() ? '<button class="icon-button" data-action="duplicate-program" data-id="' + escapeHtml(program.id) + '" aria-label="Dupliquer ce programme" title="Dupliquer">⧉</button>' : "") +
      (isAdmin() ? '<button class="icon-button" data-action="edit-program" data-id="' + escapeHtml(program.id) + '" aria-label="Modifier ce programme" title="Modifier">✎</button>' : "") +
      (isAdmin() ? '<button class="btn btn-danger btn-small" data-action="delete-program" data-id="' + escapeHtml(program.id) + '">Supprimer</button>' : "") +
      '</div></article>';
  }

  function renderPrograms() {
    const query = programSearchTerm.trim().toLocaleLowerCase("fr");
    const matches = massPrograms.filter(function (program) {
      const celebrationDate = new Date(program.celebration_at);
      const dateSearch = Number.isNaN(celebrationDate.getTime()) ? "" : [
        program.celebration_at,
        celebrationDate.toLocaleDateString("fr-FR"),
        formatCelebrationDate(program.celebration_at)
      ].join(" ");
      return [program.celebration_name, program.parish_name, program.choir_name, dateSearch]
        .some(function (value) { return String(value || "").toLocaleLowerCase("fr").includes(query); });
    });
    const now = Date.now();
    const upcoming = matches.filter(function (program) { return new Date(program.celebration_at).getTime() >= now; })
      .sort(function (a, b) { return new Date(a.celebration_at) - new Date(b.celebration_at); });
    const history = matches.filter(function (program) { return new Date(program.celebration_at).getTime() < now; })
      .sort(function (a, b) { return new Date(b.celebration_at) - new Date(a.celebration_at); });
    const loading = !programsLoaded ? '<section class="section-card"><div class="empty-state"><h3>Chargement des programmes…</h3></div></section>' :
      programLoadError ? '<section class="section-card"><div class="empty-state"><h3>Programmes indisponibles</h3><p>Vérifie la configuration Supabase et réessaie.</p><button class="btn btn-secondary" data-action="reload-programs">Réessayer</button></div></section>' : "";
    const upcomingContent = upcoming.length
      ? '<div class="mass-program-grid">' + upcoming.map(massProgramCard).join("") + '</div>'
      : '<section class="section-card"><div class="empty-state"><h3>Aucune célébration à venir</h3><p>Les prochains programmes de la chorale apparaîtront ici.</p></div></section>';
    const historyContent = history.length
      ? '<div class="mass-program-grid">' + history.map(massProgramCard).join("") + '</div>'
      : '<section class="section-card"><div class="empty-state"><h3>Aucun historique</h3><p>Les célébrations passées seront conservées ici.</p></div></section>';
    return pageHeading("VIE LITURGIQUE DE LA CHORALE", "Programme des messes", "Préparez les célébrations et retrouvez facilement les chants choisis pour chaque étape.", isAdmin() ? '<button class="btn btn-primary" data-action="new-program">＋ Créer un programme</button>' : "") +
      '<section class="program-search-card"><label class="search-wrap"><span aria-hidden="true">⌕</span><input id="program-search" class="field" type="search" placeholder="Rechercher par célébration, paroisse ou date…" value="' + escapeHtml(programSearchTerm) + '" aria-label="Rechercher un programme"></label><span class="program-count">' + matches.length + (matches.length === 1 ? " programme" : " programmes") + '</span></section>' +
      loading +
      (programsLoaded && !programLoadError ? '<section class="program-section"><div class="program-section-heading"><div><p class="eyebrow">À VENIR</p><h2>Prochaines célébrations</h2></div><span class="program-section-count">' + upcoming.length + '</span></div>' + upcomingContent + '</section>' +
      '<section class="program-section"><div class="program-section-heading"><div><p class="eyebrow">MÉMOIRE DE LA CHORALE</p><h2>Historique des messes</h2></div><span class="program-section-count">' + history.length + '</span></div>' + historyContent + '</section>' : "");
  }

  function findDraftStep(stepId) {
    return programDraft.steps.find(function (step) { return step.stage_key === stepId; });
  }

  function renderProgramEditor() {
    const existing = massPrograms.find(function (program) { return program.id === programDraft.id; });
    const fields = programDraft;
    const typeOptions = MASS_TYPES.map(function (type) {
      return '<option value="' + type.id + '"' + (fields.mass_type === type.id ? " selected" : "") + '>' + escapeHtml(type.label) + '</option>';
    }).join("");
    const stepCards = MASS_STEPS.map(function (definition) {
      const step = findDraftStep(definition.id);
      const selectedSongs = (step.song_ids || []).map(function (songId) {
        return songs.find(function (item) { return item.id === songId; });
      }).filter(Boolean);
      const songRows = selectedSongs.map(function (song) {
        return '<div class="program-selected-song"><span class="program-selected-icon" aria-hidden="true">♫</span><div class="program-selected-copy"><strong>' + escapeHtml(song.title) + '</strong><span>' + escapeHtml(song.category) + (song.author ? " · " + escapeHtml(song.author) : "") + '</span></div>' +
          '<button type="button" class="text-link" data-action="preview-program-song" data-id="' + escapeHtml(song.id) + '" aria-label="Consulter ' + escapeHtml(song.title) + '">Consulter</button>' +
          '<button type="button" class="text-link replace-program-song" data-action="replace-program-song" data-step="' + definition.id + '" data-id="' + escapeHtml(song.id) + '">Remplacer</button>' +
          '<button type="button" class="icon-button" data-action="remove-program-song" data-step="' + definition.id + '" data-id="' + escapeHtml(song.id) + '" aria-label="Retirer ' + escapeHtml(song.title) + '">×</button></div>';
      }).join("");
      return '<article class="program-step-card' + (step.is_visible ? "" : " is-hidden") + '">' +
        '<label class="program-step-toggle"><input type="checkbox" data-program-step-visible="' + definition.id + '"' + (step.is_visible ? " checked" : "") + '><span class="program-step-number">' + step.position + '</span><span>' + escapeHtml(definition.label) + '</span></label>' +
        (step.is_visible ? '<div class="program-step-content">' +
          (definition.noSong ? '<p class="field-hint">Étape de la célébration, sans chant à sélectionner.</p>' :
            songRows + (selectedSongs.length < 3 ? '<button type="button" class="btn btn-secondary choose-program-song" data-action="choose-program-song" data-step="' + definition.id + '">' + (selectedSongs.length ? "＋ Ajouter un chant (" + selectedSongs.length + "/3)" : "＋ Choisir un chant") + '</button>' :
              '<p class="field-hint">Maximum de trois chants pour cette étape.</p>')) +
          '<label class="form-field program-note-field"><span>Note pour les choristes <span class="optional-label">(facultatif)</span></span><textarea class="textarea-field" rows="2" maxlength="1000" data-program-note="' + definition.id + '" placeholder="Ex. : Commencer doucement, entrer après le signal…">' + escapeHtml(step.note || "") + '</textarea></label>' +
        '</div>' : '<p class="program-hidden-note">Cette étape sera masquée dans le programme imprimé.</p>') +
      '</article>';
    }).join("");
    openModal(existing ? "Modifier le programme" : "Préparer une célébration", "Organisez les chants dans l’ordre de la messe. Les chants sont liés à la bibliothèque, sans être copiés.", '<form class="modal-body program-editor" id="program-form" novalidate>' +
      '<div class="form-grid"><div class="form-field full"><label for="program-name">Nom de la célébration <span>*</span></label><input class="field" id="program-name" name="celebration_name" maxlength="160" required value="' + escapeHtml(fields.celebration_name) + '" placeholder="Ex. : 30e dimanche du Temps ordinaire"></div>' +
      '<div class="form-field"><label for="program-type">Type de messe <span>*</span></label><select class="select-field" id="program-type" name="mass_type" required>' + typeOptions + '</select></div>' +
      '<div class="form-field"><label for="program-date">Date et heure <span>*</span></label><input class="field" id="program-date" name="celebration_at" type="datetime-local" required value="' + escapeHtml(dateTimeInputValue(fields.celebration_at)) + '"></div>' +
      '<div class="form-field"><label for="program-parish">Paroisse <span>*</span></label><input class="field" id="program-parish" name="parish_name" maxlength="160" required value="' + escapeHtml(fields.parish_name) + '"></div>' +
      '<div class="form-field"><label for="program-celebrant">Célébrant <span class="optional-label">(facultatif)</span></label><input class="field" id="program-celebrant" name="celebrant_name" maxlength="160" value="' + escapeHtml(fields.celebrant_name || "") + '"></div>' +
      '<div class="form-field"><label for="program-choir">Nom de la chorale <span>*</span></label><input class="field" id="program-choir" name="choir_name" maxlength="160" required value="' + escapeHtml(fields.choir_name) + '"></div>' +
      '<div class="form-field full"><label for="program-notes">Notes générales <span class="optional-label">(facultatif)</span></label><textarea class="textarea-field" id="program-notes" name="general_notes" rows="3" maxlength="3000" placeholder="Informations utiles à toute la chorale…">' + escapeHtml(fields.general_notes || "") + '</textarea></div></div>' +
      '<section class="program-editor-steps"><div class="program-editor-heading"><div><p class="eyebrow">DÉROULÉ LITURGIQUE</p><h3>Chants et interventions</h3><p class="field-hint">Décoche les étapes inutiles. Tu peux choisir jusqu’à trois chants par étape.</p></div><span class="program-step-count">' + MASS_STEPS.length + ' étapes</span></div>' + stepCards + '</section>' +
      '<div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close-modal">Annuler</button><button type="submit" class="btn btn-primary">' + (existing ? "Enregistrer les modifications" : "Enregistrer le programme") + '</button></div></form>');
    $("program-form").addEventListener("submit", saveMassProgram);
  }

  function openProgramEditor(program, duplicate) {
    if (!isAdmin()) return;
    const source = program || {};
    const sourceSteps = source.steps || [];
    programDraft = {
      id: duplicate || !program ? newId() : program.id,
      celebration_name: duplicate ? source.celebration_name + " (copie)" : source.celebration_name || "",
      mass_type: source.mass_type || "sunday",
      celebration_at: duplicate ? "" : source.celebration_at || "",
      parish_name: source.parish_name || "Paroisse Saint Kizito",
      celebrant_name: source.celebrant_name || "",
      choir_name: source.choir_name || "Chorale Saint Remond",
      general_notes: source.general_notes || "",
      steps: emptyProgramSteps().map(function (step) {
        const previous = sourceSteps.find(function (item) { return item.stage_key === step.stage_key; });
        return previous ? Object.assign({}, step, {
          is_visible: previous.is_visible,
          song_ids: previous.song_ids || (previous.song_id ? [previous.song_id] : []),
          note: previous.note || ""
        }) : step;
      })
    };
    renderProgramEditor();
  }

  async function saveMassProgram(event) {
    event.preventDefault();
    if (!isAdmin() || !programDraft) return;
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const values = new FormData(form);
    const payload = {
      p_id: programDraft.id,
      p_celebration_name: String(values.get("celebration_name") || "").trim(),
      p_mass_type: String(values.get("mass_type") || ""),
      p_celebration_at: new Date(String(values.get("celebration_at") || "")).toISOString(),
      p_parish_name: String(values.get("parish_name") || "").trim(),
      p_celebrant_name: String(values.get("celebrant_name") || "").trim(),
      p_choir_name: String(values.get("choir_name") || "").trim(),
      p_general_notes: String(values.get("general_notes") || "").trim(),
      p_steps: programDraft.steps.map(function (step) {
        return {
          stage_key: step.stage_key,
          position: step.position,
          is_visible: step.is_visible,
          song_ids: step.song_ids || [],
          note: step.note || ""
        };
      })
    };
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const result = await client.rpc("save_mass_program", payload);
      if (result.error) throw result.error;
      programDraft = null;
      closeModal();
      notify("Le programme de la messe a été enregistré.");
      await loadMassPrograms();
    } catch (error) {
      submit.disabled = false;
      notify(friendlyError(error, "Impossible d’enregistrer le programme."), true);
    }
  }

  function openProgramSongPicker(stepId) {
    programPickerStep = stepId;
    programPickerReplaceSongId = null;
    programPickerSearch = "";
    renderProgramSongPicker();
  }

  function openProgramSongReplacementPicker(stepId, songId) {
    programPickerStep = stepId;
    programPickerReplaceSongId = songId;
    programPickerSearch = "";
    renderProgramSongPicker();
  }

  function renderProgramSongPicker() {
    const definition = MASS_STEPS.find(function (step) { return step.id === programPickerStep; });
    const query = programPickerSearch.trim().toLocaleLowerCase("fr");
    const results = songs.filter(function (song) { return song.title.toLocaleLowerCase("fr").includes(query); });
    const rows = results.length ? '<div class="program-song-options">' + results.map(function (song) {
      const step = findDraftStep(programPickerStep);
      const selected = (step.song_ids || []).includes(song.id);
      return '<article class="program-song-option"><div class="program-song-option-icon">♫</div><div class="program-song-option-copy"><strong>' + escapeHtml(song.title) + '</strong><span>' + escapeHtml(song.category) + (song.author ? " · " + escapeHtml(song.author) : "") + '</span>' +
        (song.lyrics ? '<p>' + escapeHtml(song.lyrics.slice(0, 160)) + (song.lyrics.length > 160 ? "…" : "") + '</p>' : "") + '</div>' +
        '<button type="button" class="btn ' + (selected ? "btn-secondary" : "btn-primary") + ' btn-small" data-action="select-program-song" data-id="' + escapeHtml(song.id) + '"' + (selected ? " disabled" : "") + '>' + (selected ? "Déjà ajouté" : "Choisir") + '</button></article>';
    }).join("") + '</div>' : '<div class="empty-state"><h3>Aucun chant trouvé</h3><p>Modifie la recherche ou ajoute d’abord le chant à la bibliothèque.</p></div>';
    const pickerTitle = programPickerReplaceSongId ? "Remplacer un chant" : "Choisir un chant";
    openModal(pickerTitle, definition ? "Étape : " + definition.label + " · maximum trois chants" : "Sélection dans la bibliothèque Chora", '<div class="modal-body program-picker"><label class="search-wrap"><span aria-hidden="true">⌕</span><input class="field" id="program-song-search" type="search" placeholder="Rechercher un chant par titre…" value="' + escapeHtml(programPickerSearch) + '" aria-label="Rechercher un chant"></label>' + rows +
      '<div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="back-to-program-editor">Retour au programme</button></div></div>');
  }

  async function openProgramSongPreview(songId) {
    const song = songs.find(function (item) { return item.id === songId; });
    if (!song) return;
    const audioEntries = VOICE_PARTS.map(function (voice) {
      const part = song.voices && song.voices[voice.id];
      return part && part.audio ? { label: voice.label, audio: part.audio } : null;
    }).filter(Boolean);
    openModal(escapeHtml(song.title), "Chant sélectionné dans la bibliothèque Chora", '<div class="modal-body program-song-preview"><span class="pill">' + escapeHtml(song.category) + '</span>' +
      (song.author ? '<p class="program-preview-author">Auteur : ' + escapeHtml(song.author) + '</p>' : "") +
      '<div class="program-preview-lyrics">' + (song.lyrics ? '<h3>Paroles</h3><div class="lyrics">' + escapeHtml(song.lyrics) + '</div>' : '<p class="field-hint">Aucune parole renseignée.</p>') + '</div>' +
      '<div class="program-preview-media" id="program-preview-media"><p class="field-hint">Chargement des documents…</p></div>' +
      '<div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="back-to-program-editor">Retour au programme</button></div></div>');
    modal.dataset.programSongId = song.id;
    const media = [];
    if (song.pdf) media.push({ kind: "pdf", label: "Partition complète", file: song.pdf });
    if (song.audio) media.push({ kind: "audio", label: "Enregistrement commun", file: song.audio });
    audioEntries.forEach(function (entry) { media.push({ kind: "audio", label: "Voix " + entry.label, file: entry.audio }); });
    const signed = await Promise.all(media.map(async function (entry) {
      return {
        kind: entry.kind,
        label: entry.label,
        file: entry.file,
        url: await signedUrl(entry.file.path),
        downloadUrl: entry.kind === "pdf" ? await signedUrl(entry.file.path, { download: entry.file.name }) : ""
      };
    }));
    if (modal.dataset.programSongId !== song.id) return;
    $("program-preview-media").innerHTML = signed.length ? signed.map(function (entry) {
      return '<div class="program-preview-media-item"><strong>' + escapeHtml(entry.label) + ' · ' + escapeHtml(entry.file.name) + '</strong>' +
        (entry.kind === "pdf"
          ? (entry.url ? '<a class="btn btn-secondary btn-small" href="' + escapeHtml(entry.url) + '" target="_blank" rel="noopener noreferrer">Ouvrir la partition PDF</a>' + (entry.downloadUrl ? '<a class="btn btn-secondary btn-small" href="' + escapeHtml(entry.downloadUrl) + '">Télécharger</a>' : "") : '<span class="field-hint">Partition indisponible.</span>')
          : (entry.url ? '<audio controls preload="metadata" src="' + escapeHtml(entry.url) + '"></audio>' : '<span class="field-hint">Enregistrement indisponible.</span>')) + '</div>';
    }).join("") : '<p class="field-hint">Aucun document audio ou PDF associé à ce chant.</p>';
  }

  function openProgramDetails(program) {
    selectedProgram = program;
    const steps = (program.steps || []).filter(function (step) { return step.is_visible; });
    const stepsHtml = steps.map(function (step) {
      const definition = MASS_STEPS.find(function (item) { return item.id === step.stage_key; });
      const songList = (step.songs || []).map(function (song) {
        return '<span class="print-program-song">' + escapeHtml(song.title) + '</span>';
      }).join("");
      return '<li class="print-program-step"><span class="print-program-step-name">' + escapeHtml(definition ? definition.label : step.stage_key) + '</span>' +
        (songList || (definition && definition.noSong ? "" : '<span class="print-program-unspecified">—</span>')) +
        (step.note ? '<span class="print-program-note">' + escapeHtml(step.note) + '</span>' : '') + '</li>';
    }).join("");
    const chooser = isAdmin() ? '<button type="button" class="btn btn-secondary" data-action="edit-program" data-id="' + escapeHtml(program.id) + '">Modifier</button><button type="button" class="btn btn-secondary" data-action="duplicate-program" data-id="' + escapeHtml(program.id) + '">Dupliquer</button><button type="button" class="btn btn-danger" data-action="delete-program" data-id="' + escapeHtml(program.id) + '">Supprimer</button>' : "";
    openModal(escapeHtml(program.celebration_name), "Programme liturgique de la chorale", '<div class="modal-body program-print-content"><div class="print-program-header"><p class="eyebrow">PROGRAMME DE LA CÉLÉBRATION</p><h2>' + escapeHtml(program.celebration_name) + '</h2><p><strong>' + escapeHtml(formatCelebrationDate(program.celebration_at)) + '</strong></p><p>' + escapeHtml(massTypeLabel(program.mass_type)) + '</p><p><strong>Paroisse :</strong> ' + escapeHtml(program.parish_name) + '</p>' +
      (program.celebrant_name ? '<p><strong>Célébrant :</strong> ' + escapeHtml(program.celebrant_name) + '</p>' : "") + '<p><strong>Chorale :</strong> ' + escapeHtml(program.choir_name) + '</p></div>' +
      (program.general_notes ? '<section class="print-program-general-notes"><h3>Notes générales</h3><p>' + escapeHtml(program.general_notes) + '</p></section>' : "") +
      '<ol class="print-program-steps">' + stepsHtml + '</ol>' +
      '<div class="modal-actions no-print"><button type="button" class="btn btn-secondary" data-action="close-modal">Fermer</button><button type="button" class="btn btn-primary" data-action="print-program">Imprimer / Enregistrer en PDF</button>' + chooser + '</div></div>');
    modal.dataset.programId = program.id;
  }

  async function deleteMassProgram(program) {
    if (!isAdmin() || !window.confirm("Supprimer le programme « " + program.celebration_name + " » ? Cette action est définitive.")) return;
    const result = await client.from("mass_programs").delete().eq("id", program.id).select("id");
    if (result.error || !result.data || !result.data.length) {
      notify(friendlyError(result.error, "Impossible de supprimer le programme."), true);
      return;
    }
    closeModal();
    selectedProgram = null;
    notify("Le programme a été supprimé.");
    await loadMassPrograms();
  }

  function render() {
    $("library-count").textContent = String(songs.length);
    if (!user) return;
    content.innerHTML = currentPage === "dashboard" ? renderDashboard() :
      currentPage === "categories" ? renderCategories() :
      currentPage === "programs" ? renderPrograms() :
      currentPage === "members" ? renderMembers() : renderLibrary();
  }

  /* ---------- Fenêtres modales ---------- */

  function openModal(title, subtitle, body) {
    modal.innerHTML = '<div class="modal-head"><div><h2 id="modal-title">' + title + '</h2><p>' + subtitle + '</p></div><button class="icon-button" data-action="close-modal" aria-label="Fermer">×</button></div>' + body;
    modalBackdrop.hidden = false;
    document.body.style.overflow = "hidden";
    const first = modal.querySelector("input, textarea, select, button");
    if (first) first.focus();
  }

  function closeModal() {
    modalBackdrop.hidden = true;
    document.body.style.overflow = "";
    modal.innerHTML = "";
    delete modal.dataset.songId;
  }

  function voiceFileFields(voice, song) {
    const files = song && song.voices ? song.voices[voice.id] : null;
    return '<fieldset class="voice-file-card"><legend><span aria-hidden="true">♫</span>' + voice.label + '</legend>' +
      '<div class="form-field"><label for="song-' + voice.id + '-audio">Enregistrement audio de la voix</label><input class="file-input" id="song-' + voice.id + '-audio" name="' + voice.id + '_audio" type="file" accept="audio/*"><p class="field-hint">Facultatif, 5 Mo maximum.' + (files && files.audio ? " Actuel : " + escapeHtml(files.audio.name) : "") + '</p></div></fieldset>';
  }

  function openSongForm(song) {
    if (!isAdmin()) return;
    const editing = !!song;
    const options = CATEGORIES.map(function (category) {
      return '<option value="' + escapeHtml(category) + '"' + (song && song.category === category ? " selected" : "") + '>' + escapeHtml(category) + '</option>';
    }).join("");
    const voiceFields = VOICE_PARTS.map(function (voice) { return voiceFileFields(voice, song); }).join("");
    openModal(editing ? "Modifier le chant" : "Ajouter un chant", "Les champs marqués d’un astérisque sont obligatoires.", '<form class="modal-body" id="song-form" novalidate>' +
      '<div class="form-grid"><div class="form-field full"><label for="song-title">Titre du chant <span>*</span></label><input class="field" id="song-title" name="title" maxlength="140" required value="' + escapeHtml(song ? song.title : "") + '" placeholder="Ex. : Peuple de lumière"></div>' +
      '<div class="form-field"><label for="song-category">Catégorie <span>*</span></label><select class="select-field" id="song-category" name="category" required><option value="">Choisir une catégorie</option>' + options + '</select></div>' +
      '<div class="form-field"><label for="song-author">Auteur / compositeur</label><input class="field" id="song-author" name="author" maxlength="120" value="' + escapeHtml(song ? song.author : "") + '" placeholder="Nom, si connu"></div>' +
      '<div class="form-field"><label for="song-duration">Durée</label><input class="field" id="song-duration" name="duration" maxlength="20" value="' + escapeHtml(song ? song.duration : "") + '" placeholder="Ex. : 3 min 20"></div>' +
      '<div class="form-field full"><label for="song-lyrics">Paroles</label><textarea class="textarea-field" id="song-lyrics" name="lyrics" maxlength="30000" placeholder="Saisissez les paroles du chant…">' + escapeHtml(song ? song.lyrics : "") + '</textarea></div>' +
      '<section class="form-field full common-files"><div><h3>Partition complète</h3><p class="field-hint">Un seul PDF contenant les quatre voix : soprano, alto, ténor et basse.</p></div>' +
      '<div class="form-field"><label for="song-pdf">Partition complète (PDF)</label><input class="file-input" id="song-pdf" name="pdf" type="file" accept="application/pdf,.pdf"><p class="field-hint">PDF uniquement, 3 Mo maximum.' + (song && song.pdf ? " Fichier actuel : " + escapeHtml(song.pdf.name) : "") + '</p></div>' +
      (song && song.audio ? '<div class="form-field"><label for="song-audio">Ancien enregistrement commun (facultatif)</label><input class="file-input" id="song-audio" name="audio" type="file" accept="audio/*"><p class="field-hint">Remplace l’ancien audio commun, conservé pour ce chant. Audio, 5 Mo maximum. Actuel : ' + escapeHtml(song.audio.name) + '</p></div>' : '') + '</section>' +
      '<section class="form-field full voice-files"><div><h3>Audios par pupitre</h3><p class="field-hint">Ajoutez un enregistrement audio distinct pour chaque voix. Les quatre voix partagent la partition PDF ci-dessus. Les fichiers existants sont conservés si vous n’en sélectionnez pas de nouveaux.</p></div><div class="voice-files-grid">' + voiceFields + '</div></section></div>' +
      '<div class="modal-actions"><button type="button" class="btn btn-secondary" data-action="close-modal">Annuler</button><button type="submit" class="btn btn-primary">' + (editing ? "Enregistrer les modifications" : "Ajouter le chant") + '</button></div></form>');
    $("song-form").addEventListener("submit", function (event) {
      event.preventDefault();
      saveSong(event.currentTarget, song);
    });
  }

  function checkFile(file, kind) {
    if (!file) return "";
    if (kind === "pdf") {
      if (file.size > MAX_PDF) return "La partition dépasse la limite de 3 Mo.";
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) return "Le document doit être un fichier PDF.";
    } else {
      if (file.size > MAX_AUDIO) return "L’enregistrement dépasse la limite de 5 Mo.";
      if (!file.type.startsWith("audio/")) return "Le fichier choisi n’est pas reconnu comme un fichier audio.";
    }
    return "";
  }

  async function uploadFile(songId, kind, blob, name, type) {
    const extension = kind.endsWith("pdf") ? "pdf" : (String(name).split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "audio");
    const path = songId + "/" + kind + "-" + Date.now() + "-" + newId().slice(0, 8) + "." + extension;
    const result = await client.storage.from(BUCKET).upload(path, blob, { contentType: type, upsert: false });
    if (result.error) throw result.error;
    return path;
  }

  async function saveSong(form, existing) {
    if (!isAdmin()) return;
    const formData = new FormData(form);
    const title = String(formData.get("title") || "").trim();
    const category = String(formData.get("category") || "");
    if (!title || !CATEGORIES.includes(category)) {
      notify("Veuillez renseigner un titre et choisir une catégorie.", true);
      return;
    }
    const mediaFiles = [{ kind: "pdf", input: form.elements.pdf }];
    if (form.elements.audio) mediaFiles.push({ kind: "audio", input: form.elements.audio });
    VOICE_PARTS.forEach(function (voice) {
      mediaFiles.push({ kind: "audio", voice: voice, input: form.elements[voice.id + "_audio"] });
    });
    const invalidFile = mediaFiles.find(function (item) {
      item.file = item.input.files[0] || null;
      item.error = checkFile(item.file, item.kind);
      return !!item.error;
    });
    const fileError = invalidFile ? (invalidFile.voice ? invalidFile.voice.label + " : " : "") + invalidFile.error : "";
    if (fileError) {
      notify(fileError, true);
      return;
    }
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    const songId = existing ? existing.id : newId();
    const uploaded = [];
    const obsolete = [];
    const fields = {
      title: title,
      category: category,
      author: String(formData.get("author") || "").trim(),
      duration: String(formData.get("duration") || "").trim(),
      lyrics: String(formData.get("lyrics") || "").trim()
    };
    try {
      for (const item of mediaFiles) {
        if (!item.file) continue;
        const fileKey = item.kind;
        const storageKind = item.voice ? item.voice.id + "-" + item.kind : item.kind;
        const path = await uploadFile(songId, storageKind, item.file, item.file.name, item.kind === "pdf" ? "application/pdf" : item.file.type);
        uploaded.push(path);
        const columnPrefix = item.voice ? item.voice.id + "_" : "";
        fields[columnPrefix + fileKey + "_path"] = path;
        fields[columnPrefix + fileKey + "_name"] = item.file.name.slice(0, 200);
        const previous = item.voice
          ? existing && existing.voices && existing.voices[item.voice.id] && existing.voices[item.voice.id][fileKey]
          : existing && existing[fileKey];
        if (previous) obsolete.push(previous.path);
      }
      if (existing) {
        const result = await client.from("songs").update(fields).eq("id", songId).select("id");
        if (result.error) throw result.error;
        if (!result.data || !result.data.length) throw new Error("row-level security : modification refusée");
      } else {
        const result = await client.from("songs").insert(Object.assign({ id: songId }, fields));
        if (result.error) throw result.error;
      }
    } catch (error) {
      if (uploaded.length) await client.storage.from(BUCKET).remove(uploaded);
      notify(friendlyError(error, "Enregistrement impossible."), true);
      submit.disabled = false;
      return;
    }
    if (obsolete.length) client.storage.from(BUCKET).remove(obsolete);
    await loadSongs();
    closeModal();
    render();
    notify(existing ? "Le chant a été mis à jour." : "Le chant a été ajouté à la bibliothèque.");
  }

  async function signedUrl(path, options) {
    const result = await client.storage.from(BUCKET).createSignedUrl(path, 3600, options);
    return result.error ? "" : result.data.signedUrl;
  }

  async function openDetails(song) {
    const lyrics = song.lyrics ? '<div class="lyrics">' + escapeHtml(song.lyrics) + '</div>' : '<p class="field-hint">Aucune parole renseignée.</p>';
    const fileGroups = [];
    const commonFiles = [];
    if (song.pdf) commonFiles.push({ kind: "pdf", file: song.pdf });
    if (song.audio) commonFiles.push({ kind: "audio", file: song.audio });
    if (commonFiles.length) fileGroups.push({ label: "Documents communs", files: commonFiles });
    VOICE_PARTS.forEach(function (voice) {
      const part = song.voices && song.voices[voice.id];
      const files = [];
      if (part && part.audio) files.push({ kind: "audio", file: part.audio });
      if (files.length) fileGroups.push({ label: voice.label, files: files });
    });
    const hasFiles = fileGroups.length > 0;
    openModal(escapeHtml(song.title), "Fiche du chant", '<div class="modal-body"><div class="detail-category"><span class="pill">' + escapeHtml(song.category) + '</span></div><div class="detail-meta">' +
      (song.author ? '<span><strong>Auteur :</strong> ' + escapeHtml(song.author) + '</span>' : "") +
      (song.duration ? '<span><strong>Durée :</strong> ' + escapeHtml(song.duration) + '</span>' : "") +
      '<span><strong>Ajouté le :</strong> ' + formatDate(song.createdAt) + '</span></div>' +
      '<div class="detail-files" id="detail-files">' + (hasFiles ? '<span class="field-hint">Chargement des documents…</span>' : '<span class="field-hint">Aucun document associé à ce chant.</span>') + '</div>' +
      '<h3 class="detail-lyrics-heading">Paroles</h3>' + lyrics +
      '<div class="modal-actions"><button class="btn btn-secondary" data-action="close-modal">Fermer</button>' +
      (isAdmin() ? '<button class="btn btn-primary" data-action="edit" data-id="' + escapeHtml(song.id) + '">Modifier le chant</button>' : "") + '</div></div>');
    modal.dataset.songId = song.id;
    if (!hasFiles) return;
    const files = fileGroups.reduce(function (all, group) {
      return all.concat(group.files.map(function (entry) { return { group: group.label, kind: entry.kind, file: entry.file }; }));
    }, []);
    const media = await Promise.all(files.map(async function (entry) {
      return {
        group: entry.group,
        kind: entry.kind,
        file: entry.file,
        url: await signedUrl(entry.file.path),
        downloadUrl: entry.kind === "pdf" ? await signedUrl(entry.file.path, { download: entry.file.name }) : ""
      };
    }));
    if (modal.dataset.songId !== song.id) return;
    $("detail-files").innerHTML = fileGroups.map(function (group) {
      const groupMedia = media.filter(function (entry) { return entry.group === group.label; });
      return '<section class="voice-media-card"><h3>' + escapeHtml(group.label) + '</h3>' + groupMedia.map(function (entry) {
        if (entry.kind === "pdf") {
          return '<div class="voice-media-item"><span class="voice-media-name">▤ ' + escapeHtml(entry.file.name) + '</span><div class="voice-media-actions">' +
            (entry.url ? '<a class="btn btn-secondary btn-small" href="' + escapeHtml(entry.url) + '" target="_blank" rel="noopener noreferrer">Ouvrir le PDF</a>' : '<span class="field-hint">Partition indisponible.</span>') +
            (entry.downloadUrl ? '<a class="btn btn-secondary btn-small" href="' + escapeHtml(entry.downloadUrl) + '">Télécharger</a>' : "") + '</div></div>';
        }
        return '<div class="voice-media-item"><span class="voice-media-name">♫ ' + escapeHtml(entry.file.name) + '</span>' +
          (entry.url ? '<audio controls preload="metadata" src="' + escapeHtml(entry.url) + '">Votre navigateur ne peut pas lire cet audio.</audio>' : '<span class="field-hint">Enregistrement indisponible.</span>') + '</div>';
      }).join("") + '</section>';
    }).join("");
  }

  function confirmDelete(song) {
    openModal("Supprimer ce chant ?", "Cette action est définitive pour tous les membres.", '<div class="modal-body"><p>Voulez-vous vraiment supprimer <strong>' + escapeHtml(song.title) + '</strong> et ses documents associés ?</p><div class="modal-actions"><button class="btn btn-secondary" data-action="close-modal">Annuler</button><button class="btn btn-danger" data-action="confirm-delete" data-id="' + escapeHtml(song.id) + '">Supprimer définitivement</button></div></div>');
  }

  async function deleteSong(song) {
    const result = await client.from("songs").delete().eq("id", song.id).select("id");
    if (result.error || !result.data || !result.data.length) {
      notify(friendlyError(result.error, "Suppression refusée."), true);
      return;
    }
    const paths = storagePaths(song);
    if (paths.length) await client.storage.from(BUCKET).remove(paths);
    await loadSongs();
    closeModal();
    render();
    notify("Le chant a été supprimé.");
  }

  function storagePaths(song) {
    const paths = [song.pdf && song.pdf.path, song.audio && song.audio.path];
    VOICE_PARTS.forEach(function (voice) {
      const part = song.voices && song.voices[voice.id];
      if (part) paths.push(part.audio && part.audio.path);
    });
    return paths.filter(Boolean);
  }

  /* ---------- Sauvegarde et import (administrateurs) ---------- */

  function exportBackup() {
    if (!isAdmin()) return;
    const backup = {
      format: "chora-library",
      version: 3,
      exportedAt: new Date().toISOString(),
      songs: songs.map(function (song) {
        const backupSong = {
          title: song.title, category: song.category, author: song.author, duration: song.duration,
          lyrics: song.lyrics, createdAt: song.createdAt,
          pdf: song.pdf ? { name: song.pdf.name } : null, audio: song.audio ? { name: song.audio.name } : null
        };
        backupSong.voices = VOICE_PARTS.reduce(function (parts, voice) {
          const media = song.voices && song.voices[voice.id];
          parts[voice.id] = { audio: media && media.audio ? { name: media.audio.name } : null };
          return parts;
        }, {});
        return backupSong;
      })
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "chora-sauvegarde-" + new Date().toISOString().slice(0, 10) + ".json";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    notify("Sauvegarde des fiches téléchargée (sans les PDF ni les audios, conservés en ligne).");
  }

  function validAttachment(file, kind) {
    if (!file || typeof file !== "object" || typeof file.name !== "string" || typeof file.data !== "string") return false;
    const pattern = kind === "pdf" ? /^data:application\/pdf;base64,[A-Za-z0-9+/=]+$/ : /^data:audio\/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/;
    if (!pattern.test(file.data)) return false;
    const payload = file.data.slice(file.data.indexOf(",") + 1);
    const bytes = Math.floor(payload.length * 3 / 4) - (payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0);
    return bytes <= (kind === "pdf" ? MAX_PDF : MAX_AUDIO);
  }

  function cleanImported(raw) {
    if (!raw || typeof raw !== "object") return null;
    const text = function (value, max) { return typeof value === "string" && value.length <= max ? value.trim() : null; };
    const title = text(raw.title, 140);
    const author = raw.author == null ? "" : text(raw.author, 120);
    const duration = raw.duration == null ? "" : text(raw.duration, 20);
    const lyrics = raw.lyrics == null ? "" : text(raw.lyrics, 30000);
    if (!title || author === null || duration === null || lyrics === null || !CATEGORIES.includes(raw.category)) return null;
    const pdf = raw.pdf && typeof raw.pdf.data === "string" ? raw.pdf : null;
    const audio = raw.audio && typeof raw.audio.data === "string" ? raw.audio : null;
    if ((pdf && !validAttachment(pdf, "pdf")) || (audio && !validAttachment(audio, "audio"))) return null;
    const rawVoices = raw.voices == null ? {} : raw.voices;
    if (typeof rawVoices !== "object" || Array.isArray(rawVoices)) return null;
    const voices = {};
    for (const voice of VOICE_PARTS) {
      const part = rawVoices[voice.id];
      if (part != null && (typeof part !== "object" || Array.isArray(part))) return null;
      const rawAudio = part && part.audio;
      if (rawAudio != null && (typeof rawAudio !== "object" || Array.isArray(rawAudio))) return null;
      const partAudio = rawAudio && typeof rawAudio.data === "string" ? rawAudio : null;
      if (rawAudio && Object.prototype.hasOwnProperty.call(rawAudio, "data") && !partAudio) return null;
      if (partAudio && !validAttachment(partAudio, "audio")) return null;
      voices[voice.id] = { audio: partAudio };
    }
    return { title: title, category: raw.category, author: author, duration: duration, lyrics: lyrics, pdf: pdf, audio: audio, voices: voices };
  }

  function dataUrlToBlob(dataUrl) {
    const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: match[1] });
  }

  async function importSongs(list) {
    if (!isAdmin() || importing) return null;
    importing = true;
    notify("Import en cours, veuillez patienter…");
    const known = new Set(songs.map(function (song) { return (song.title + "|" + song.category).toLocaleLowerCase("fr"); }));
    let added = 0;
    let skipped = 0;
    let failed = 0;
    for (const item of list) {
      const key = (item.title + "|" + item.category).toLocaleLowerCase("fr");
      if (known.has(key)) { skipped += 1; continue; }
      const id = newId();
      const uploaded = [];
      const fields = { id: id, title: item.title, category: item.category, author: item.author, duration: item.duration, lyrics: item.lyrics };
      try {
        if (item.pdf) {
          fields.pdf_path = await uploadFile(id, "pdf", dataUrlToBlob(item.pdf.data), item.pdf.name, "application/pdf");
          fields.pdf_name = item.pdf.name.slice(0, 200);
          uploaded.push(fields.pdf_path);
        }
        if (item.audio) {
          const audioBlob = dataUrlToBlob(item.audio.data);
          fields.audio_path = await uploadFile(id, "audio", audioBlob, item.audio.name, audioBlob.type);
          fields.audio_name = item.audio.name.slice(0, 200);
          uploaded.push(fields.audio_path);
        }
        for (const voice of VOICE_PARTS) {
          const part = item.voices && item.voices[voice.id];
          const attachment = part && part.audio;
          if (!attachment) continue;
          const blob = dataUrlToBlob(attachment.data);
          const path = await uploadFile(id, voice.id + "-audio", blob, attachment.name, blob.type);
          fields[voice.id + "_audio_path"] = path;
          fields[voice.id + "_audio_name"] = attachment.name.slice(0, 200);
          uploaded.push(path);
        }
        const result = await client.from("songs").insert(fields);
        if (result.error) throw result.error;
        known.add(key);
        added += 1;
      } catch (error) {
        if (uploaded.length) await client.storage.from(BUCKET).remove(uploaded);
        failed += 1;
      }
    }
    importing = false;
    await loadSongs();
    render();
    notify(added + " chant(s) importé(s), " + skipped + " déjà présent(s), " + failed + " en échec.", failed > 0);
    return { added: added, skipped: skipped, failed: failed };
  }

  function restoreBackup(file) {
    if (!file || !isAdmin()) return;
    if (file.size > 30 * 1024 * 1024) {
      notify("Le fichier de sauvegarde dépasse la taille maximale de 30 Mo.", true);
      return;
    }
    const reader = new FileReader();
    reader.onerror = function () { notify("Impossible de lire le fichier de sauvegarde.", true); };
    reader.onload = function () {
      try {
        const backup = JSON.parse(String(reader.result));
        if (!backup || backup.format !== "chora-library" || !Array.isArray(backup.songs)) {
          throw new Error("Ce fichier ne correspond pas à une sauvegarde Chora valide.");
        }
        const cleaned = backup.songs.map(cleanImported);
        if (cleaned.some(function (item) { return !item; })) throw new Error("La sauvegarde contient des chants ou des fichiers invalides.");
        if (!window.confirm("Importer " + cleaned.length + " chant(s) dans la bibliothèque partagée ? Les chants déjà présents seront ignorés.")) return;
        importSongs(cleaned);
      } catch (error) {
        notify(error.message || "Le fichier de sauvegarde est invalide.", true);
      }
    };
    reader.readAsText(file);
  }

  async function importLegacy() {
    const legacy = readLegacySongs();
    if (!legacy.length) return;
    if (!window.confirm("Importer " + legacy.length + " chant(s) de cet appareil dans la bibliothèque partagée ?")) return;
    const outcome = await importSongs(legacy);
    if (outcome && outcome.failed === 0) {
      localStorage.setItem(LEGACY_DONE_KEY, "1");
      render();
    }
  }

  /* ---------- Événements ---------- */

  document.addEventListener("click", function (event) {
    const authTab = event.target.closest("[data-auth-mode]");
    if (authTab) { setAuthMode(authTab.dataset.authMode); return; }
    if (!user) return;
    const pageLink = event.target.closest("[data-page]");
    if (pageLink) {
      event.preventDefault();
      searchTerm = "";
      categoryFilter = "";
      navigate(pageLink.dataset.page);
      return;
    }
    const action = event.target.closest("[data-action]");
    if (!action) return;
    if (action.dataset.action === "new-program") { openProgramEditor(null, false); return; }
    if (action.dataset.action === "view-program") {
      const program = massPrograms.find(function (item) { return item.id === action.dataset.id; });
      if (program) openProgramDetails(program);
      return;
    }
    if (action.dataset.action === "edit-program" || action.dataset.action === "duplicate-program") {
      if (!isAdmin()) return;
      const program = massPrograms.find(function (item) { return item.id === action.dataset.id; });
      if (!program) return;
      openProgramEditor(program, action.dataset.action === "duplicate-program");
      return;
    }
    if (action.dataset.action === "delete-program") {
      const program = massPrograms.find(function (item) { return item.id === action.dataset.id; });
      if (program) deleteMassProgram(program);
      return;
    }
    if (action.dataset.action === "reload-programs") { loadMassPrograms(); return; }
    if (action.dataset.action === "choose-program-song") { openProgramSongPicker(action.dataset.step); return; }
    if (action.dataset.action === "replace-program-song") {
      openProgramSongReplacementPicker(action.dataset.step, action.dataset.id);
      return;
    }
    if (action.dataset.action === "select-program-song") {
      if (!programDraft || !programPickerStep) return;
      const step = findDraftStep(programPickerStep);
      const isAvailableSong = songs.some(function (item) { return item.id === action.dataset.id; });
      if (step && isAvailableSong) {
        const songIds = step.song_ids || [];
        if (programPickerReplaceSongId) {
          const replaceIndex = songIds.indexOf(programPickerReplaceSongId);
          if (replaceIndex >= 0 && !songIds.includes(action.dataset.id)) songIds[replaceIndex] = action.dataset.id;
        } else if (!songIds.includes(action.dataset.id) && songIds.length < 3) {
          songIds.push(action.dataset.id);
        }
        step.song_ids = songIds;
      }
      programPickerStep = null;
      programPickerReplaceSongId = null;
      renderProgramEditor();
      return;
    }
    if (action.dataset.action === "back-to-program-editor") {
      programPickerStep = null;
      programPickerReplaceSongId = null;
      renderProgramEditor();
      return;
    }
    if (action.dataset.action === "remove-program-song") {
      const step = programDraft && findDraftStep(action.dataset.step);
      if (step) step.song_ids = (step.song_ids || []).filter(function (songId) { return songId !== action.dataset.id; });
      renderProgramEditor();
      return;
    }
    if (action.dataset.action === "preview-program-song") { openProgramSongPreview(action.dataset.id); return; }
    if (action.dataset.action === "toggle-program-step") {
      const step = programDraft && findDraftStep(action.dataset.step);
      if (step) step.is_visible = !step.is_visible;
      renderProgramEditor();
      return;
    }
    if (action.dataset.action === "print-program") {
      document.body.classList.add("printing-program");
      const afterPrint = function () {
        document.body.classList.remove("printing-program");
        window.removeEventListener("afterprint", afterPrint);
      };
      window.addEventListener("afterprint", afterPrint);
      window.print();
      return;
    }
    const song = songs.find(function (item) { return item.id === action.dataset.id; });
    switch (action.dataset.action) {
      case "new-song": openSongForm(null); break;
      case "close-modal": closeModal(); break;
      case "details": if (song) openDetails(song); break;
      case "edit": if (song) openSongForm(song); break;
      case "delete": if (song && isAdmin()) confirmDelete(song); break;
      case "confirm-delete": if (song && isAdmin()) deleteSong(song); break;
      case "favorite": if (song) toggleFavorite(song); break;
      case "toggle-role": if (isAdmin()) changeRole(action.dataset.id); break;
      case "import-legacy": importLegacy(); break;
      case "open-category":
        searchTerm = "";
        categoryFilter = action.dataset.category || "";
        navigate("library");
        break;
      case "clear-category":
        categoryFilter = "";
        render();
        break;
    }
  });

  content.addEventListener("input", function (event) {
    if (event.target.id === "song-search") {
      const start = event.target.selectionStart;
      searchTerm = event.target.value;
      render();
      const nextInput = $("song-search");
      if (nextInput) { nextInput.focus(); nextInput.setSelectionRange(start, start); }
    }
    if (event.target.id === "program-search") {
      const start = event.target.selectionStart;
      programSearchTerm = event.target.value;
      render();
      const nextInput = $("program-search");
      if (nextInput) { nextInput.focus(); nextInput.setSelectionRange(start, start); }
    }
  });

  modal.addEventListener("input", function (event) {
    const target = event.target;
    if (target.id === "program-song-search") {
      const start = target.selectionStart;
      programPickerSearch = target.value;
      renderProgramSongPicker();
      const nextInput = $("program-song-search");
      if (nextInput) { nextInput.focus(); nextInput.setSelectionRange(start, start); }
      return;
    }
    if (target.dataset.programNote && programDraft) {
      const step = findDraftStep(target.dataset.programNote);
      if (step) step.note = target.value;
      return;
    }
    if (target.form && target.form.id === "program-form" && target.name && programDraft) {
      programDraft[target.name] = target.value;
    }
  });

  modal.addEventListener("change", function (event) {
    const target = event.target;
    if (target.dataset.programStepVisible && programDraft) {
      const step = findDraftStep(target.dataset.programStepVisible);
      if (step) step.is_visible = target.checked;
      renderProgramEditor();
      return;
    }
    if (target.form && target.form.id === "program-form" && target.name && programDraft) {
      programDraft[target.name] = target.value;
    }
  });

  content.addEventListener("change", function (event) {
    if (event.target.id === "category-filter") { categoryFilter = event.target.value; render(); }
    if (event.target.id === "sort-filter") { sortBy = event.target.value; render(); }
  });

  $("export-button").addEventListener("click", exportBackup);
  $("import-button").addEventListener("click", function () { $("backup-file").click(); });
  $("backup-file").addEventListener("change", function (event) {
    restoreBackup(event.target.files[0]);
    event.target.value = "";
  });
  $("sign-out-button").addEventListener("click", signOut);
  $("menu-toggle").addEventListener("click", function () {
    $("sidebar").classList.toggle("open");
    $("mobile-overlay").classList.toggle("open");
  });
  $("mobile-overlay").addEventListener("click", closeMenu);
  modalBackdrop.addEventListener("click", function (event) { if (event.target === modalBackdrop) closeModal(); });
  document.addEventListener("keydown", function (event) { if (event.key === "Escape" && !modalBackdrop.hidden) closeModal(); });
  $("auth-form").addEventListener("submit", function (event) { submitAuth(event); });
  $("auth-forgot").addEventListener("click", function () { forgotPassword(); });
  $("footer-year").textContent = String(new Date().getFullYear());

  /* ---------- Démarrage ---------- */

  setAuthMode("signin");
  if (!window.supabase || !config.supabaseUrl || !config.supabaseKey) {
    showAuth();
    setAuthMessage("Le service en ligne n'est pas disponible. Vérifiez votre connexion Internet puis rechargez la page.", true);
    $("auth-submit").disabled = true;
    return;
  }
  client = window.supabase.createClient(config.supabaseUrl, config.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  client.auth.onAuthStateChange(function (event, session) {
    if (event === "PASSWORD_RECOVERY") recoveryPending = true;
    window.setTimeout(function () { handleAuthChange(session); }, 0);
  });
})();
