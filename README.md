# Chora – Chorale Saint Remond KM 36

Bibliothèque de chants partagée (Paroisse Saint Kizito KM36). Site statique (HTML, Tailwind CDN, JS) avec **Supabase** pour les comptes, les données et les fichiers.

## Rôles
- **Admin** : ajoute, modifie et supprime les chants avec une partition PDF complète (les quatre voix sur un seul PDF, ≤ 3 Mo) et des audios facultatifs distincts pour les pupitres soprano, alto, ténor et basse (≤ 5 Mo chacun) ; gère les membres (page « Membres »), sauvegarde/importe.
- **Choriste** : à l'inscription, choisit son pupitre (soprano, alto, ténor, basse ou solo) ; consulte et recherche les chants, ouvre la partition PDF complète, écoute les enregistrements de son pupitre et gère ses favoris privés.
- **Programmes des messes** : tous les membres peuvent consulter, rechercher et imprimer les célébrations à venir et leur historique. Les administrateurs créent, modifient, dupliquent et suppriment les programmes. Chaque étape peut référencer jusqu’à trois chants existants sans les copier; le déroulé comprend notamment l’Évangile et l’homélie, le Credo, le Pater et le baiser de paix.

Les droits sont appliqués par la base (RLS + policies Storage), pas seulement par l'interface.

## Mise en route
1. Supabase → **SQL Editor** → coller et exécuter `supabase/schema.sql`. Après une mise à jour du site, réexécutez ce script : il ajoute le champ vocal des profils, les colonnes des audios et les tables des programmes de messes.
2. Supabase → **Authentication → URL Configuration** : mettre l'URL du site hébergé (ex. Netlify) en *Site URL* et *Redirect URL*. Évitez d'ouvrir le site en `file://` (liens d'e-mail de confirmation).
3. Créer un compte avec `johnkpoghomou@gmail.com`, confirmer l'e-mail, se connecter : ce compte devient admin automatiquement.
4. Les autres s'inscrivent librement (choristes) ; l'admin peut promouvoir depuis « Membres ».

## Configuration
`assets/js/config.js` contient l'URL du projet et la clé publique (publishable/anon), sûres côté navigateur. Ne jamais y mettre la clé `service_role`.

## Déploiement Netlify et Google Search Console
- Connectez le dépôt GitHub à Netlify : la configuration `netlify.toml` publie le site statique et génère `sitemap.xml` et `robots.txt` à chaque build à partir de l'URL HTTPS du site fournie par Netlify.
- Après le premier déploiement, vérifiez `https://VOTRE-SITE.netlify.app/sitemap.xml` et `https://VOTRE-SITE.netlify.app/robots.txt`.
- Dans Supabase → **Authentication → URL Configuration**, définissez l'URL Netlify comme *Site URL* et ajoutez-la aux URL de redirection autorisées.
- Ajoutez le domaine du site à Google Search Console, validez-en la propriété, puis soumettez `sitemap.xml`. Le site est une application avec authentification : le sitemap ne référence que sa page d'accueil publique; la bibliothèque et les programmes restent réservés aux membres connectés.

## Données locales de l'ancienne version
Un bandeau sur le tableau de bord (admin) propose d'importer les chants du navigateur ; les anciennes sauvegardes JSON (v1) et les sauvegardes v2/v3 (métadonnées) sont importables. Les sauvegardes ne contiennent pas les fichiers PDF ni audio, qui restent conservés dans Supabase.

Développé par [JohnnyCodeur Tech](https://johnnycodeur-tech-guinee.netlify.app).
