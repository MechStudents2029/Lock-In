# Benchmark validation report

**Status** No reproducible benchmark was available. The CV plan describes pretrained detection, landmark estimation and feature extraction. The checkout contained no activity classifier experiment code, split manifests, recordings, labels, checkpoints, per-example predictions or reported scores. Leakage, class balance, overfitting and generalization therefore remain unverified.

## Acceptance protocol

1. Freeze a private manifest with pseudonymous participant, session, source clip, time bounds, label, sampling policy and consent status. Report per-class counts for participants, sessions and prediction windows. Inspect labels and confusion pairs for ambiguity.
2. Split by participant for unseen-person evaluation and keep all sessions and overlapping windows from a source together. If the prototype has only one participant, hold out complete sessions and limit claims to within-person generalization. Deduplicate before splitting. Reset state at session boundaries and use causal windows with no future frames.
3. Freeze one held-out manifest for the rules, Random Forest and neural network. Use identical eligible windows, feature extraction, label definitions and scoring. Fit imputers, scalers, class weights and augmentation policies on training data. Tune rules, thresholds and hyperparameters only on development data. Use group-aware validation and retain per-split learning curves or train/validation scores to check overfitting.
4. Report macro F1, balanced accuracy, per-class precision and recall, support and a confusion matrix, including a majority-class reference for context. State how missing classes and undefined metrics are handled. Include overall coverage, abstention by class and metrics both on the full cohort and at a common coverage level. Count abstentions as missed predictions for true-class recall in full-cohort scoring. Keep no-evidence windows in the evaluation manifest.
5. Compare models using paired predictions and group-level uncertainty intervals where enough independent groups exist. Report false reminders per hour, delay to detection and performance by camera placement and lighting where sample size permits. Avoid treating adjacent windows as independent samples.
6. Archive seeds, source revision, config and split hashes, model hashes, package lock, device and exact commands. Keep private labels and predictions in controlled storage, and publish aggregate outputs only after privacy review.

Frame-diagonal normalization in the CV plan can reduce resolution dependence under matching framing. It does not by itself establish invariance to camera distance, perspective or pose. Test those factors separately and record landmark dropout and detection rates alongside classifier performance.
