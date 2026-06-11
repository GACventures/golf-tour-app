import { useEffect, useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Alert,
  Modal,
  ActivityIndicator,
} from "react-native";
import { colors } from "@theme/colors";
import { supabase } from "@lib/supabase";

type Player = {
  id: string;
  name: string;
};

type Pair = {
  id: string;
  player1Id: string;
  player2Id: string;
  player1Name: string;
  player2Name: string;
  isDeleted: boolean;
};

type Team = {
  id: string;
  name: string;
  playerIds: string[];
  playerNames: string[];
  isDeleted: boolean;
  isModified: boolean;
};

export default function EditTourPairsTeamsScreen({ navigation, route }: any) {
  const { tourId, tourName } = route.params || {};

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [players, setPlayers] = useState<Player[]>([]);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);

  // Modal states
  const [showAddPairModal, setShowAddPairModal] = useState(false);
  const [showEditPairModal, setShowEditPairModal] = useState(false);
  const [showAddTeamModal, setShowAddTeamModal] = useState(false);
  const [showEditTeamModal, setShowEditTeamModal] = useState(false);

  // Current editing states
  const [editingPair, setEditingPair] = useState<Pair | null>(null);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);

  // New pair/team states
  const [newPairPlayer1, setNewPairPlayer1] = useState<string>("");
  const [newPairPlayer2, setNewPairPlayer2] = useState<string>("");
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamPlayers, setNewTeamPlayers] = useState<string[]>([]);

  useEffect(() => {
    loadData();
  }, [tourId]);

  const loadData = async () => {
    if (!tourId) return;

    setLoading(true);
    setError(null);

    try {
      // Load players
      const { data: playersData, error: playersErr } = await supabase
        .from("tour_players")
        .select("player_id, players(id, name)")
        .eq("tour_id", tourId)
        .order("players(name)", { ascending: true });

      if (playersErr) throw playersErr;

      const playersList: Player[] = (playersData || []).map((row: any) => {
        const player = Array.isArray(row.players) ? row.players[0] : row.players;
        return {
          id: row.player_id,
          name: player?.name || "Unknown Player",
        };
      });

      setPlayers(playersList);

      // Load pairs and teams
      const { data: groupsData, error: groupsErr } = await supabase
        .from("tour_groups")
        .select("id, type, name, tour_group_members(player_id)")
        .eq("tour_id", tourId)
        .eq("scope", "tour")
        .in("type", ["pair", "team"]);

      if (groupsErr) throw groupsErr;

      const pairsList: Pair[] = [];
      const teamsList: Team[] = [];

      (groupsData || []).forEach((group: any) => {
        const memberIds = (group.tour_group_members || []).map((m: any) => m.player_id);
        
        if (group.type === "pair" && memberIds.length === 2) {
          const player1 = playersList.find(p => p.id === memberIds[0]);
          const player2 = playersList.find(p => p.id === memberIds[1]);
          
          pairsList.push({
            id: group.id,
            player1Id: memberIds[0],
            player2Id: memberIds[1],
            player1Name: player1?.name || "Unknown",
            player2Name: player2?.name || "Unknown",
            isDeleted: false,
          });
        } else if (group.type === "team") {
          const playerNames = memberIds.map(id => {
            const player = playersList.find(p => p.id === id);
            return player?.name || "Unknown";
          });
          
          teamsList.push({
            id: group.id,
            name: group.name || "Unnamed Team",
            playerIds: memberIds,
            playerNames: playerNames,
            isDeleted: false,
            isModified: false,
          });
        }
      });

      setPairs(pairsList);
      setTeams(teamsList);
    } catch (err: any) {
      setError(err.message || "Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  const checkPlayerOverlap = (playerId: string, excludeGroupId?: string): string | null => {
    // Check pairs
    for (const pair of pairs) {
      if (pair.isDeleted || pair.id === excludeGroupId) continue;
      if (pair.player1Id === playerId || pair.player2Id === playerId) {
        return `${pair.player1Name} & ${pair.player2Name}`;
      }
    }

    // Check teams
    for (const team of teams) {
      if (team.isDeleted || team.id === excludeGroupId) continue;
      if (team.playerIds.includes(playerId)) {
        return team.name;
      }
    }

    return null;
  };

  const showOverlapWarning = (playerNames: string[], groupNames: string[], onContinue: () => void) => {
    const playerList = playerNames.join(", ");
    const groupList = groupNames.join(", ");
    
    Alert.alert(
      "⚠️ Player Overlap Warning",
      `${playerList} ${playerNames.length > 1 ? 'are' : 'is'} already in: ${groupList}.\n\nThis may affect competition results. Continue anyway?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Continue", onPress: onContinue },
      ]
    );
  };

  const handleAddPair = () => {
    if (!newPairPlayer1 || !newPairPlayer2) {
      Alert.alert("Error", "Please select both players for the pair.");
      return;
    }

    if (newPairPlayer1 === newPairPlayer2) {
      Alert.alert("Error", "Please select two different players.");
      return;
    }

    const player1 = players.find(p => p.id === newPairPlayer1);
    const player2 = players.find(p => p.id === newPairPlayer2);

    if (!player1 || !player2) {
      Alert.alert("Error", "Invalid player selection.");
      return;
    }

    // Check for overlaps
    const overlaps: { playerId: string; playerName: string; groupName: string }[] = [];
    
    const overlap1 = checkPlayerOverlap(newPairPlayer1);
    if (overlap1) overlaps.push({ playerId: newPairPlayer1, playerName: player1.name, groupName: overlap1 });
    
    const overlap2 = checkPlayerOverlap(newPairPlayer2);
    if (overlap2) overlaps.push({ playerId: newPairPlayer2, playerName: player2.name, groupName: overlap2 });

    const addPairAction = () => {
      const newPair: Pair = {
        id: `new-${Date.now()}`,
        player1Id: newPairPlayer1,
        player2Id: newPairPlayer2,
        player1Name: player1.name,
        player2Name: player2.name,
        isDeleted: false,
      };

      setPairs([...pairs, newPair]);
      setShowAddPairModal(false);
      setNewPairPlayer1("");
      setNewPairPlayer2("");
    };

    if (overlaps.length > 0) {
      const playerNames = overlaps.map(o => o.playerName);
      const groupNames = overlaps.map(o => o.groupName);
      showOverlapWarning(playerNames, groupNames, addPairAction);
    } else {
      addPairAction();
    }
  };

  const handleEditPair = () => {
    if (!editingPair || !newPairPlayer1 || !newPairPlayer2) {
      Alert.alert("Error", "Please select both players for the pair.");
      return;
    }

    if (newPairPlayer1 === newPairPlayer2) {
      Alert.alert("Error", "Please select two different players.");
      return;
    }

    const player1 = players.find(p => p.id === newPairPlayer1);
    const player2 = players.find(p => p.id === newPairPlayer2);

    if (!player1 || !player2) {
      Alert.alert("Error", "Invalid player selection.");
      return;
    }

    // Check for overlaps (excluding current pair)
    const overlaps: { playerId: string; playerName: string; groupName: string }[] = [];
    
    const overlap1 = checkPlayerOverlap(newPairPlayer1, editingPair.id);
    if (overlap1) overlaps.push({ playerId: newPairPlayer1, playerName: player1.name, groupName: overlap1 });
    
    const overlap2 = checkPlayerOverlap(newPairPlayer2, editingPair.id);
    if (overlap2) overlaps.push({ playerId: newPairPlayer2, playerName: player2.name, groupName: overlap2 });

    const editPairAction = () => {
      setPairs(pairs.map(p => 
        p.id === editingPair.id
          ? {
              ...p,
              player1Id: newPairPlayer1,
              player2Id: newPairPlayer2,
              player1Name: player1.name,
              player2Name: player2.name,
            }
          : p
      ));
      setShowEditPairModal(false);
      setEditingPair(null);
      setNewPairPlayer1("");
      setNewPairPlayer2("");
    };

    if (overlaps.length > 0) {
      const playerNames = overlaps.map(o => o.playerName);
      const groupNames = overlaps.map(o => o.groupName);
      showOverlapWarning(playerNames, groupNames, editPairAction);
    } else {
      editPairAction();
    }
  };

  const handleDeletePair = (pairId: string) => {
    Alert.alert(
      "Delete Pair",
      "Are you sure you want to delete this pair? This may affect competition results.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            setPairs(pairs.map(p => p.id === pairId ? { ...p, isDeleted: true } : p));
          },
        },
      ]
    );
  };

  const handleAddTeam = () => {
    if (!newTeamName.trim()) {
      Alert.alert("Error", "Please enter a team name.");
      return;
    }

    if (newTeamPlayers.length < 2) {
      Alert.alert("Error", "A team must have at least 2 players.");
      return;
    }

    if (newTeamPlayers.length > 12) {
      Alert.alert("Error", "A team cannot have more than 12 players.");
      return;
    }

    const playerNames = newTeamPlayers.map(id => {
      const player = players.find(p => p.id === id);
      return player?.name || "Unknown";
    });

    // Check for overlaps
    const overlaps: { playerId: string; playerName: string; groupName: string }[] = [];
    
    newTeamPlayers.forEach(playerId => {
      const overlap = checkPlayerOverlap(playerId);
      if (overlap) {
        const player = players.find(p => p.id === playerId);
        if (player) {
          overlaps.push({ playerId, playerName: player.name, groupName: overlap });
        }
      }
    });

    const addTeamAction = () => {
      const newTeam: Team = {
        id: `new-${Date.now()}`,
        name: newTeamName.trim(),
        playerIds: newTeamPlayers,
        playerNames: playerNames,
        isDeleted: false,
        isModified: false,
      };

      setTeams([...teams, newTeam]);
      setShowAddTeamModal(false);
      setNewTeamName("");
      setNewTeamPlayers([]);
    };

    if (overlaps.length > 0) {
      const playerNamesList = overlaps.map(o => o.playerName);
      const groupNames = overlaps.map(o => o.groupName);
      showOverlapWarning(playerNamesList, groupNames, addTeamAction);
    } else {
      addTeamAction();
    }
  };

  const handleEditTeam = () => {
    if (!editingTeam || !newTeamName.trim()) {
      Alert.alert("Error", "Please enter a team name.");
      return;
    }

    if (newTeamPlayers.length < 2) {
      Alert.alert("Error", "A team must have at least 2 players.");
      return;
    }

    if (newTeamPlayers.length > 12) {
      Alert.alert("Error", "A team cannot have more than 12 players.");
      return;
    }

    const playerNames = newTeamPlayers.map(id => {
      const player = players.find(p => p.id === id);
      return player?.name || "Unknown";
    });

    // Check for overlaps (excluding current team)
    const overlaps: { playerId: string; playerName: string; groupName: string }[] = [];
    
    newTeamPlayers.forEach(playerId => {
      const overlap = checkPlayerOverlap(playerId, editingTeam.id);
      if (overlap) {
        const player = players.find(p => p.id === playerId);
        if (player) {
          overlaps.push({ playerId, playerName: player.name, groupName: overlap });
        }
      }
    });

    const editTeamAction = () => {
      setTeams(teams.map(t => 
        t.id === editingTeam.id
          ? {
              ...t,
              name: newTeamName.trim(),
              playerIds: newTeamPlayers,
              playerNames: playerNames,
              isModified: true,
            }
          : t
      ));
      setShowEditTeamModal(false);
      setEditingTeam(null);
      setNewTeamName("");
      setNewTeamPlayers([]);
    };

    if (overlaps.length > 0) {
      const playerNamesList = overlaps.map(o => o.playerName);
      const groupNames = overlaps.map(o => o.groupName);
      showOverlapWarning(playerNamesList, groupNames, editTeamAction);
    } else {
      editTeamAction();
    }
  };

  const handleDeleteTeam = (teamId: string) => {
    Alert.alert(
      "Delete Team",
      "Are you sure you want to delete this team? This may affect competition results.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            setTeams(teams.map(t => t.id === teamId ? { ...t, isDeleted: true } : t));
          },
        },
      ]
    );
  };

  const openEditPairModal = (pair: Pair) => {
    setEditingPair(pair);
    setNewPairPlayer1(pair.player1Id);
    setNewPairPlayer2(pair.player2Id);
    setShowEditPairModal(true);
  };

  const openEditTeamModal = (team: Team) => {
    setEditingTeam(team);
    setNewTeamName(team.name);
    setNewTeamPlayers([...team.playerIds]);
    setShowEditTeamModal(true);
  };

  const generateNextTeamName = () => {
    const existingTeams = teams.filter(t => !t.isDeleted);
    let counter = 1;
    let name = `Team ${counter}`;
    
    while (existingTeams.some(t => t.name === name)) {
      counter++;
      name = `Team ${counter}`;
    }
    
    return name;
  };

  const openAddTeamModal = () => {
    setNewTeamName(generateNextTeamName());
    setNewTeamPlayers([]);
    setShowAddTeamModal(true);
  };

  const toggleTeamPlayer = (playerId: string) => {
    if (newTeamPlayers.includes(playerId)) {
      setNewTeamPlayers(newTeamPlayers.filter(id => id !== playerId));
    } else {
      if (newTeamPlayers.length >= 12) {
        Alert.alert("Limit Reached", "A team cannot have more than 12 players.");
        return;
      }
      setNewTeamPlayers([...newTeamPlayers, playerId]);
    }
  };

  const handleSave = async () => {
    if (!tourId) return;

    setSaving(true);
    setError(null);

    try {
      // Delete all existing tour-level groups
      await supabase
        .from("tour_groups")
        .delete()
        .eq("tour_id", tourId)
        .eq("scope", "tour");

      // Insert pairs
      const activePairs = pairs.filter(p => !p.isDeleted);
      if (activePairs.length > 0) {
        const pairsToInsert = activePairs.map(pair => ({
          tour_id: tourId,
          scope: "tour",
          type: "pair",
          name: null,
          round_id: null,
        }));

        const { data: insertedPairs, error: pairsError } = await supabase
          .from("tour_groups")
          .insert(pairsToInsert)
          .select("id");

        if (pairsError) throw pairsError;

        // Insert pair members
        const pairMembersToInsert: any[] = [];
        activePairs.forEach((pair, index) => {
          const groupId = insertedPairs[index]?.id;
          if (!groupId) return;

          pairMembersToInsert.push(
            { group_id: groupId, player_id: pair.player1Id },
            { group_id: groupId, player_id: pair.player2Id }
          );
        });

        if (pairMembersToInsert.length > 0) {
          const { error: membersError } = await supabase
            .from("tour_group_members")
            .insert(pairMembersToInsert);

          if (membersError) throw membersError;
        }
      }

      // Insert teams
      const activeTeams = teams.filter(t => !t.isDeleted);
      if (activeTeams.length > 0) {
        const teamsToInsert = activeTeams.map(team => ({
          tour_id: tourId,
          scope: "tour",
          type: "team",
          name: team.name,
          round_id: null,
        }));

        const { data: insertedTeams, error: teamsError } = await supabase
          .from("tour_groups")
          .insert(teamsToInsert)
          .select("id");

        if (teamsError) throw teamsError;

        // Insert team members
        const teamMembersToInsert: any[] = [];
        activeTeams.forEach((team, index) => {
          const groupId = insertedTeams[index]?.id;
          if (!groupId) return;

          team.playerIds.forEach(playerId => {
            teamMembersToInsert.push({
              group_id: groupId,
              player_id: playerId,
            });
          });
        });

        if (teamMembersToInsert.length > 0) {
          const { error: membersError } = await supabase
            .from("tour_group_members")
            .insert(teamMembersToInsert);

          if (membersError) throw membersError;
        }
      }

      Alert.alert("Success", "Pairs and teams saved successfully!", [
        { text: "OK", onPress: () => navigation.goBack() },
      ]);
    } catch (err: any) {
      setError(err.message || "Failed to save changes");
      Alert.alert("Error", err.message || "Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="white" />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error && !pairs.length && !teams.length) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={loadData}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const activePairs = pairs.filter(p => !p.isDeleted);
  const activeTeams = teams.filter(t => !t.isDeleted);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>Edit Pairs & Teams</Text>
        <Text style={styles.subtitle}>{tourName}</Text>

        {/* Pairs Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pairs</Text>
          <Text style={styles.helperText}>
            Pairs are used for competitions like foursomes or better ball
          </Text>

          {activePairs.length === 0 ? (
            <Text style={styles.emptyText}>No pairs created yet</Text>
          ) : (
            <View style={styles.itemsList}>
              {activePairs.map((pair) => (
                <View key={pair.id} style={styles.item}>
                  <Text style={styles.itemText}>
                    {pair.player1Name} & {pair.player2Name}
                  </Text>
                  <View style={styles.itemActions}>
                    <TouchableOpacity
                      style={styles.editButton}
                      onPress={() => openEditPairModal(pair)}
                    >
                      <Text style={styles.editButtonText}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.deleteButton}
                      onPress={() => handleDeletePair(pair.id)}
                    >
                      <Text style={styles.deleteButtonText}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          )}

          <TouchableOpacity
            style={styles.addButton}
            onPress={() => setShowAddPairModal(true)}
          >
            <Text style={styles.addButtonText}>+ Add Pair</Text>
          </TouchableOpacity>
        </View>

        {/* Teams Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Teams</Text>
          <Text style={styles.helperText}>
            Teams are used for team competitions (2-12 players per team)
          </Text>

          {activeTeams.length === 0 ? (
            <Text style={styles.emptyText}>No teams created yet</Text>
          ) : (
            <View style={styles.itemsList}>
              {activeTeams.map((team) => (
                <View key={team.id} style={styles.item}>
                  <View style={styles.teamContent}>
                    <Text style={styles.teamName}>{team.name}</Text>
                    <Text style={styles.teamPlayers}>
                      {team.playerNames.join(", ")}
                    </Text>
                  </View>
                  <View style={styles.itemActions}>
                    <TouchableOpacity
                      style={styles.editButton}
                      onPress={() => openEditTeamModal(team)}
                    >
                      <Text style={styles.editButtonText}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.deleteButton}
                      onPress={() => handleDeleteTeam(team.id)}
                    >
                      <Text style={styles.deleteButtonText}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          )}

          <TouchableOpacity
            style={styles.addButton}
            onPress={openAddTeamModal}
          >
            <Text style={styles.addButtonText}>+ Add Team</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Footer Buttons */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.cancelButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          <Text style={styles.saveButtonText}>
            {saving ? "Saving..." : "Save Changes"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Add Pair Modal */}
      <Modal
        visible={showAddPairModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowAddPairModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Add Pair</Text>

            <Text style={styles.label}>Player 1</Text>
            <View style={styles.pickerContainer}>
              <ScrollView style={styles.playerPicker}>
                <TouchableOpacity
                  style={styles.playerOption}
                  onPress={() => setNewPairPlayer1("")}
                >
                  <Text style={[styles.playerOptionText, !newPairPlayer1 && styles.playerOptionSelected]}>
                    Select Player 1...
                  </Text>
                </TouchableOpacity>
                {players.map((player) => (
                  <TouchableOpacity
                    key={player.id}
                    style={styles.playerOption}
                    onPress={() => setNewPairPlayer1(player.id)}
                  >
                    <Text style={[styles.playerOptionText, newPairPlayer1 === player.id && styles.playerOptionSelected]}>
                      {player.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <Text style={styles.label}>Player 2</Text>
            <View style={styles.pickerContainer}>
              <ScrollView style={styles.playerPicker}>
                <TouchableOpacity
                  style={styles.playerOption}
                  onPress={() => setNewPairPlayer2("")}
                >
                  <Text style={[styles.playerOptionText, !newPairPlayer2 && styles.playerOptionSelected]}>
                    Select Player 2...
                  </Text>
                </TouchableOpacity>
                {players.map((player) => (
                  <TouchableOpacity
                    key={player.id}
                    style={styles.playerOption}
                    onPress={() => setNewPairPlayer2(player.id)}
                  >
                    <Text style={[styles.playerOptionText, newPairPlayer2 === player.id && styles.playerOptionSelected]}>
                      {player.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => {
                  setShowAddPairModal(false);
                  setNewPairPlayer1("");
                  setNewPairPlayer2("");
                }}
              >
                <Text style={styles.modalCancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSaveButton}
                onPress={handleAddPair}
              >
                <Text style={styles.modalSaveButtonText}>Add Pair</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit Pair Modal */}
      <Modal
        visible={showEditPairModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowEditPairModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Edit Pair</Text>

            <Text style={styles.label}>Player 1</Text>
            <View style={styles.pickerContainer}>
              <ScrollView style={styles.playerPicker}>
                {players.map((player) => (
                  <TouchableOpacity
                    key={player.id}
                    style={styles.playerOption}
                    onPress={() => setNewPairPlayer1(player.id)}
                  >
                    <Text style={[styles.playerOptionText, newPairPlayer1 === player.id && styles.playerOptionSelected]}>
                      {player.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <Text style={styles.label}>Player 2</Text>
            <View style={styles.pickerContainer}>
              <ScrollView style={styles.playerPicker}>
                {players.map((player) => (
                  <TouchableOpacity
                    key={player.id}
                    style={styles.playerOption}
                    onPress={() => setNewPairPlayer2(player.id)}
                  >
                    <Text style={[styles.playerOptionText, newPairPlayer2 === player.id && styles.playerOptionSelected]}>
                      {player.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => {
                  setShowEditPairModal(false);
                  setEditingPair(null);
                  setNewPairPlayer1("");
                  setNewPairPlayer2("");
                }}
              >
                <Text style={styles.modalCancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSaveButton}
                onPress={handleEditPair}
              >
                <Text style={styles.modalSaveButtonText}>Save Changes</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Add Team Modal */}
      <Modal
        visible={showAddTeamModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowAddTeamModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Add Team</Text>

            <Text style={styles.label}>Team Name</Text>
            <TextInput
              style={styles.input}
              value={newTeamName}
              onChangeText={setNewTeamName}
              placeholder="Enter team name"
              placeholderTextColor="rgba(255,255,255,0.5)"
            />

            <Text style={styles.label}>
              Select Players ({newTeamPlayers.length}/12)
            </Text>
            <View style={styles.pickerContainer}>
              <ScrollView style={styles.playerPicker}>
                {players.map((player) => (
                  <TouchableOpacity
                    key={player.id}
                    style={styles.playerOption}
                    onPress={() => toggleTeamPlayer(player.id)}
                  >
                    <Text style={[
                      styles.playerOptionText,
                      newTeamPlayers.includes(player.id) && styles.playerOptionSelected
                    ]}>
                      {newTeamPlayers.includes(player.id) ? "✓ " : ""}{player.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => {
                  setShowAddTeamModal(false);
                  setNewTeamName("");
                  setNewTeamPlayers([]);
                }}
              >
                <Text style={styles.modalCancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSaveButton}
                onPress={handleAddTeam}
              >
                <Text style={styles.modalSaveButtonText}>Add Team</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit Team Modal */}
      <Modal
        visible={showEditTeamModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowEditTeamModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Edit Team</Text>

            <Text style={styles.label}>Team Name</Text>
            <TextInput
              style={styles.input}
              value={newTeamName}
              onChangeText={setNewTeamName}
              placeholder="Enter team name"
              placeholderTextColor="rgba(255,255,255,0.5)"
            />

            <Text style={styles.label}>
              Select Players ({newTeamPlayers.length}/12)
            </Text>
            <View style={styles.pickerContainer}>
              <ScrollView style={styles.playerPicker}>
                {players.map((player) => (
                  <TouchableOpacity
                    key={player.id}
                    style={styles.playerOption}
                    onPress={() => toggleTeamPlayer(player.id)}
                  >
                    <Text style={[
                      styles.playerOptionText,
                      newTeamPlayers.includes(player.id) && styles.playerOptionSelected
                    ]}>
                      {newTeamPlayers.includes(player.id) ? "✓ " : ""}{player.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => {
                  setShowEditTeamModal(false);
                  setEditingTeam(null);
                  setNewTeamName("");
                  setNewTeamPlayers([]);
                }}
              >
                <Text style={styles.modalCancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSaveButton}
                onPress={handleEditTeam}
              >
                <Text style={styles.modalSaveButtonText}>Save Changes</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.brand.green,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    color: "white",
    fontSize: 16,
    marginTop: 12,
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  errorText: {
    color: "white",
    fontSize: 16,
    textAlign: "center",
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "700",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 100,
  },
  title: {
    color: "white",
    fontSize: 28,
    fontWeight: "800",
    marginBottom: 8,
  },
  subtitle: {
    color: "#E7EFE9",
    fontSize: 16,
    marginBottom: 24,
  },
  section: {
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.2)",
  },
  sectionTitle: {
    color: "white",
    fontSize: 20,
    fontWeight: "800",
    marginBottom: 8,
  },
  helperText: {
    color: "#E7EFE9",
    fontSize: 14,
    marginBottom: 16,
    lineHeight: 20,
  },
  emptyText: {
    color: "rgba(255, 255, 255, 0.6)",
    fontSize: 14,
    fontStyle: "italic",
    marginBottom: 16,
  },
  itemsList: {
    marginBottom: 16,
  },
  item: {
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  itemText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 12,
  },
  teamContent: {
    marginBottom: 12,
  },
  teamName: {
    color: "white",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 6,
  },
  teamPlayers: {
    color: "#E7EFE9",
    fontSize: 14,
    lineHeight: 20,
  },
  itemActions: {
    flexDirection: "row",
    gap: 8,
  },
  editButton: {
    flex: 1,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  editButtonText: {
    color: "white",
    fontSize: 14,
    fontWeight: "700",
  },
  deleteButton: {
    flex: 1,
    backgroundColor: "rgba(220, 38, 38, 0.8)",
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  deleteButtonText: {
    color: "white",
    fontSize: 14,
    fontWeight: "700",
  },
  addButton: {
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.3)",
  },
  addButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "700",
  },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    padding: 20,
    backgroundColor: colors.brand.green,
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.2)",
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  cancelButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "700",
  },
  saveButton: {
    flex: 1,
    backgroundColor: "white",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    color: colors.brand.green,
    fontSize: 16,
    fontWeight: "800",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalContent: {
    backgroundColor: colors.brand.green,
    borderRadius: 16,
    padding: 24,
    width: "100%",
    maxHeight: "80%",
    borderWidth: 2,
    borderColor: "rgba(255, 255, 255, 0.3)",
  },
  modalTitle: {
    color: "white",
    fontSize: 24,
    fontWeight: "800",
    marginBottom: 20,
  },
  label: {
    color: "white",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 8,
    marginTop: 12,
  },
  input: {
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    borderRadius: 12,
    padding: 14,
    color: "white",
    fontSize: 16,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.3)",
  },
  pickerContainer: {
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    borderRadius: 12,
    maxHeight: 200,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.3)",
  },
  playerPicker: {
    maxHeight: 200,
  },
  playerOption: {
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.1)",
  },
  playerOptionText: {
    color: "white",
    fontSize: 16,
  },
  playerOptionSelected: {
    fontWeight: "700",
    color: "#FFD700",
  },
  modalButtons: {
    flexDirection: "row",
    gap: 12,
    marginTop: 24,
  },
  modalCancelButton: {
    flex: 1,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  modalCancelButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "700",
  },
  modalSaveButton: {
    flex: 1,
    backgroundColor: "white",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  modalSaveButtonText: {
    color: colors.brand.green,
    fontSize: 16,
    fontWeight: "800",
  },
});
