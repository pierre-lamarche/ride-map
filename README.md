# Ride Map

[Site en ligne](https://pierre-lamarche.github.io/ride-map/)

Cartographie interactive d'activités de vélo : superposition de multiples parcours sur une carte, avec filtrage par plage de dates.

## Principe

Le site affiche un ensemble de parcours (tracés GPS) issus d'export Strava, en vue d'ensemble :

- **Filtre par dates** : choisir une plage (du/au) pour n'afficher que les activités de la période.
- **Superposition** : le bouton « Superposer tout » dessine tous les tracés de la plage en une fois.
- **Couleur par date** : chaque tracé est coloré selon sa position dans la plage (bleu = début, rouge = fin), ce qui permet de visualiser l'évolution dans le temps. Une légende gradient indique les bornes.
- **Sélection fine** : chaque activité de la liste est un toggle (clic pour ajouter/retirer un tracé), indépendant du chargement en masse.
- **Tooltips** : au survol d'un tracé, son nom et sa date s'affichent ; le tracé survolé est mis en avant.

Le tout sans aucun backend : tout tourne dans le navigateur.

## Architecture et choix techniques

### Statique, zéro build
Le projet est constitué uniquement de fichiers servis tels quels (`index.html`, `main.js`). Pas de framework, pas d'étape de compilation : la déployer sur GitHub Pages revient à pousser les fichiers.

### Données
Les activités sont stockées en **Parquet** sur un bucket S3 (MinIO) :

- `metadonnees.parquet` : une ligne par activité (id, nom, type, date, distance, durée).
- `parquet/<id>.parquet` : le tracé GPS (latitude/longitude) de chaque activité, téléchargé à la demande (lazy loading) puis mis en cache en mémoire.

### DuckDB-WASM
Les fichiers Parquet sont lus **dans le navigateur** grâce à [DuckDB-WASM](https://duckdb.org/docs/guides/wasm/overview) :

- le metadata file est chargé au démarrage pour construire la liste ;
- chaque tracé est parsé à la volée (via `read_parquet`) au moment où il est affiché, ce qui évite de télécharger l'intégralité des tracés d'emblée.

L'interrogation se fait en SQL, ce qui facilite les évolutions (agrégations, filtres, jointures) sans toucher au reste du code.

### Leaflet
La carte est dessinée avec [Leaflet](https://leafletjs.com/) :

- fond de carte grise ESRI (World Light Gray) pour maximiser le contraste avec les couleurs des tracés ;
- polylignes pour les parcours, légende gradient et tooltips intégrés.

### Coloration
Le gradient (bleu → cyan → vert → jaune → orange/rouge) est interpolé en RGB selon la position de la date de l'activité dans la plage filtrée. Le calcul est fait côté client sur les dates ISO (extraites des métadonnées).

### Performance
- Chargement **séquentiel** des tracés avec mise à jour du statut (`i/N`) ;
- **cache en mémoire** des tracés déjà chargés (un toggle aller-retour ne re-télécharge pas) ;
- la vue d'ensemble cible 20–100+ tracés ; au-delà, on pourrait décimer les points les plus denses.
